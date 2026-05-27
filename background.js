const STORAGE_KEY = "windsurfSessions";

const USAGE_URL = "https://windsurf.com/subscription/usage";
const WINDSURF_API = "https://windsurf.com/_backend/exa.seat_management_pb.SeatManagementService";
const WINDSURF_AUTH = "https://windsurf.com/_devin-auth";

const USAGE_REFRESH_ALARM = "refreshAllUsage";
const USAGE_REFRESH_MINUTES = 10;

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.alarms.create(USAGE_REFRESH_ALARM, { periodInMinutes: USAGE_REFRESH_MINUTES });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === USAGE_REFRESH_ALARM) {
    refreshAllUsage().catch(() => {});
  }
});

async function refreshAllUsage() {
  const sessions = await getSessions();
  if (!sessions.length) return;
  const now = Date.now();
  const SKIP_MS = 2 * 60 * 1000;
  const tasks = sessions.map(async (session) => {
    if (!session.localStorage?.devin_session_token) return false;
    if (session.updatedAt && (now - new Date(session.updatedAt).getTime()) < SKIP_MS) return false;
    try {
      const usage = await fetchUsageViaAPI(session.localStorage);
      if (usage.captureState === "not-found") {
        session.tokenExpired = true;
      } else {
        session.usage = usage;
        session.tokenExpired = false;
        if (!session.groupManual) session.group = inferGroup(session.usage);
      }
      session.updatedAt = new Date().toISOString();
      return true;
    } catch (_) {
      session.tokenExpired = true;
      return true;
    }
  });
  const results = await Promise.allSettled(tasks);
  const anyUpdated = results.some((r) => r.status === "fulfilled" && r.value);
  if (anyUpdated) await saveSessions(sessions);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "getSessions":
      return getSessions();
    case "captureSession":
      return captureSession(message.name);
    case "restoreSession":
      return restoreSession(message.id);
    case "deleteSession":
      return deleteSession(message.id);
    case "updateSessionGroup":
      return updateSessionGroup(message.id, message.group);
    case "refreshUsage":
      return refreshUsage(message.id);
    case "getCurrentAccount":
      return getCurrentAccount();
    case "addAccountViaLogin":
      return addAccountViaLogin(message.email, message.password);
    case "getNextRefresh":
      return chrome.alarms.get(USAGE_REFRESH_ALARM).then((a) => a?.scheduledTime ?? null);
    case "importSessions":
      return saveSessions(message.sessions);
    default:
      throw new Error("Unknown message type");
  }
}

async function getSessions() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || [];
}

async function saveSessions(sessions) {
  await chrome.storage.local.set({ [STORAGE_KEY]: sessions });
}

async function getActiveWindsurfTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!tab?.id || !tab.url) {
    throw new Error("No active tab found");
  }

  if (!isWindsurfUrl(tab.url)) {
    throw new Error("Please open a Windsurf page before capturing or switching");
  }

  return tab;
}

function isWindsurfUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol.startsWith("http") && parsed.hostname.endsWith("windsurf.com");
  } catch {
    return false;
  }
}

async function captureSession(name) {
  const tab = await getActiveWindsurfTab();
  const parsed = new URL(tab.url);
  const cookieUrls = buildCookieUrls(parsed.hostname);

  const [storageSnapshot] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: capturePageStorage
  });

  const cookieSets = await Promise.all(cookieUrls.map((url) => chrome.cookies.getAll({ url })));
  const cookies = dedupeCookies(cookieSets.flat()).map(serializeCookie);
  const usage = await fetchUsageViaAPI(storageSnapshot.result.localStorage || {});
  const sessions = await getSessions();
  const now = new Date().toISOString();

  const sessionName = (name || usage.profileEmail || storageSnapshot.result.title || parsed.hostname).trim();
  const existingIndex =
    usage.profileEmail
      ? sessions.findIndex((item) => item.usage?.profileEmail === usage.profileEmail)
      : -1;

  if (existingIndex !== -1) {
    const existing = sessions[existingIndex];
    existing.name = sessionName;
    existing.updatedAt = now;
    existing.baseUrl = storageSnapshot.result.href || tab.url;
    existing.origin = parsed.origin;
    existing.hostname = parsed.hostname;
    existing.cookies = cookies;
    existing.localStorage = storageSnapshot.result.localStorage || {};
    existing.usage = usage;
    if (!existing.groupManual) {
      existing.group = inferGroup(usage);
    }

    sessions.splice(existingIndex, 1);
    sessions.unshift(existing);
    await saveSessions(sessions);
    return existing;
  }

  const session = {
    id: crypto.randomUUID(),
    name: sessionName,
    createdAt: now,
    updatedAt: now,
    baseUrl: storageSnapshot.result.href || tab.url,
    origin: parsed.origin,
    hostname: parsed.hostname,
    cookies,
    localStorage: storageSnapshot.result.localStorage || {},
    usage,
    group: inferGroup(usage),
    groupManual: false
  };

  sessions.unshift(session);
  await saveSessions(sessions);
  return session;
}

async function restoreSession(id) {
  const sessions = await getSessions();
  const session = sessions.find((item) => item.id === id);
  if (!session) {
    throw new Error("Saved session not found");
  }

  await clearCookiesForHostname(session.hostname);
  for (const cookie of session.cookies) {
    await setCookie(cookie);
  }

  const targetTab = await ensureWindsurfTab(USAGE_URL);
  await waitForTabComplete(targetTab.id);
  await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    args: [session.localStorage || {}],
    func: applyPageStorage
  });
  await chrome.tabs.reload(targetTab.id);

  session.usage = await fetchUsageViaAPI(session.localStorage || {});
  session.updatedAt = new Date().toISOString();
  if (!session.groupManual) {
    session.group = inferGroup(session.usage);
  }
  await saveSessions(sessions);
  return { restored: true, usage: session.usage };
}

async function refreshUsage(id) {
  const sessions = await getSessions();
  const session = sessions.find((item) => item.id === id);
  if (!session) {
    throw new Error("Saved session not found");
  }
  session.usage = await fetchUsageViaAPI(session.localStorage || {});
  session.updatedAt = new Date().toISOString();
  if (!session.groupManual) {
    session.group = inferGroup(session.usage);
  }
  await saveSessions(sessions);
  return session;
}

async function updateSessionGroup(id, group) {
  if (group !== "trial" && group !== "free") {
    throw new Error("Invalid group");
  }
  const sessions = await getSessions();
  const session = sessions.find((item) => item.id === id);
  if (!session) {
    throw new Error("Saved session not found");
  }
  session.group = group;
  session.groupManual = true;
  session.updatedAt = new Date().toISOString();
  await saveSessions(sessions);
  return session;
}

function inferGroup(usage) {
  const plan = (usage?.plan || "").toLowerCase();
  if (!plan) return "free";
  if (plan.includes("free")) return "free";
  return "trial";
}

async function getCurrentAccount() {
  try {
    const tab = await getActiveWindsurfTab();
    const [storageSnapshot] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePageStorage
    });
    const ls = storageSnapshot.result.localStorage || {};
    const usage = await fetchUsageViaAPI(ls);
    if (!usage.profileEmail) return null;
    const sessions = await getSessions();
    const match = sessions.find((s) => s.usage?.profileEmail === usage.profileEmail);
    return match || { name: usage.profileEmail, usage };
  } catch (_) {
    return null;
  }
}

async function legacyAddAccountViaLogin(email, password) {
  if (!email || !password) throw new Error("请输入邮箱和密码");

  const connRes = await fetch(`${WINDSURF_AUTH}/connections`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ product: "windsurf", email })
  });
  if (!connRes.ok) throw new Error("无法检查账号状态");

  const connData = await connRes.json();
  if (!connData.auth_method?.has_password) {
    throw new Error("该账号未设置密码，请使用浏览器登录");
  }

  const loginRes = await fetch(`${WINDSURF_AUTH}/password/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  if (!loginRes.ok) {
    const err = await loginRes.json().catch(() => ({}));
    throw new Error(err.detail || "登录失败，请检查邮箱和密码");
  }

  const loginData = await loginRes.json();
  const auth1Token = loginData.token;
  if (!auth1Token) throw new Error("登录成功但未获取到 auth1 token");

  const postAuthRes = await fetch(`${WINDSURF_API}/WindsurfPostAuth`, {
    method: "POST",
    headers: { "content-type": "application/proto", "connect-protocol-version": "1" },
    body: pbEncodeString(1, auth1Token)
  });
  if (!postAuthRes.ok) throw new Error("Token 交换失败");

  const postAuthBuf = new Uint8Array(await postAuthRes.arrayBuffer());
  const postAuthRoot = pbDecode(postAuthBuf);
  const sessionToken = pbString(postAuthRoot, 1);
  const accountId = pbString(postAuthRoot, 4);
  const orgId = pbString(postAuthRoot, 5);
  if (!sessionToken) throw new Error("Token 交换未返回 session token");

  const ls = {
    devin_session_token: JSON.stringify(sessionToken),
    devin_account_id: accountId ? JSON.stringify(accountId) : "",
    devin_primary_org_id: orgId ? JSON.stringify(orgId) : "",
    devin_auth1_token: JSON.stringify(auth1Token)
  };

  const usage = await fetchUsageViaAPI(ls);
  const sessions = await getSessions();
  const now = new Date().toISOString();
  const profileEmail = usage.profileEmail || email;

  const existingIndex = sessions.findIndex((item) => item.usage?.profileEmail === profileEmail);
  if (existingIndex !== -1) {
    sessions[existingIndex].localStorage = ls;
    sessions[existingIndex].usage = usage;
    sessions[existingIndex].updatedAt = now;
    if (!sessions[existingIndex].groupManual) {
      sessions[existingIndex].group = inferGroup(usage);
    }
    await saveSessions(sessions);
    return sessions[existingIndex];
  }

  const session = {
    id: crypto.randomUUID(),
    name: profileEmail,
    hostname: "windsurf.com",
    baseUrl: USAGE_URL,
    localStorage: ls,
    cookies: [],
    usage,
    group: inferGroup(usage),
    groupManual: false,
    createdAt: now,
    updatedAt: now
  };
  sessions.unshift(session);
  await saveSessions(sessions);
  return session;
}

async function addAccountViaLogin(email, password) {
  if (!email || !password) throw new Error("请输入邮箱和密码");

  const normalizedEmail = normalizeEmail(email);
  const existingSessions = await getSessions();
  const existingIndex = findSessionIndexByEmail(existingSessions, normalizedEmail);
  if (existingIndex !== -1) {
    return existingSessions[existingIndex];
  }

  await checkPasswordAvailability(email);
  const auth1Token = await loginWithPassword(email, password);
  const { localStorage: ls, usage } = await validateSessionAndBuildStorage(auth1Token);
  const sessions = await getSessions();
  const now = new Date().toISOString();
  const profileEmail = usage.profileEmail || email;

  const matchedIndex = findSessionIndexByEmail(sessions, normalizeEmail(profileEmail));
  if (matchedIndex !== -1) {
    sessions[matchedIndex].localStorage = ls;
    sessions[matchedIndex].usage = usage;
    sessions[matchedIndex].updatedAt = now;
    if (!sessions[matchedIndex].groupManual) {
      sessions[matchedIndex].group = inferGroup(usage);
    }
    await saveSessions(sessions);
    return sessions[matchedIndex];
  }

  const session = {
    id: crypto.randomUUID(),
    name: profileEmail,
    hostname: "windsurf.com",
    baseUrl: USAGE_URL,
    localStorage: ls,
    cookies: [],
    usage,
    group: inferGroup(usage),
    groupManual: false,
    createdAt: now,
    updatedAt: now
  };
  sessions.unshift(session);
  await saveSessions(sessions);
  return session;
}

const LOGIN_FLOW_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const LOGIN_FLOW_RETRY_DELAYS_MS = [400, 1200, 2500];

async function checkPasswordAvailability(email) {
  let connRes;
  try {
    connRes = await fetchWithLoginFlowRetry(`${WINDSURF_AUTH}/connections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product: "windsurf", email })
    });
  } catch (_) {
    throw new Error("无法检查账号状态，请稍后重试或分批导入");
  }
  if (!connRes.ok) {
    if (connRes.status === 429) {
      throw new Error("无法检查账号状态：请求过于频繁，请稍后重试或分批导入");
    }
    throw new Error("无法检查账号状态");
  }

  const connData = await connRes.json().catch(() => ({}));
  if (!connData.auth_method?.has_password) {
    throw new Error("该账号当前不支持密码导入，请走浏览器登录后保存状态");
  }

  return connData;
}

async function loginWithPassword(email, password) {
  let loginRes;
  try {
    loginRes = await fetchWithLoginFlowRetry(`${WINDSURF_AUTH}/password/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
  } catch (_) {
    throw new Error("登录请求失败，请稍后重试或分批导入");
  }

  if (!loginRes.ok) {
    if (loginRes.status === 429) {
      throw new Error("登录请求过于频繁，请稍后重试或分批导入");
    }
    const err = await loginRes.json().catch(() => ({}));
    throw new Error(err.detail || "登录失败，请检查邮箱和密码");
  }

  const loginData = await loginRes.json().catch(() => ({}));
  const auth1Token = loginData.token || loginData.auth1_token;
  if (!auth1Token) throw new Error("登录成功但未返回 auth1 token");
  return auth1Token;
}

async function fetchWithLoginFlowRetry(url, options) {
  let lastError = null;

  for (let attempt = 0; attempt <= LOGIN_FLOW_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!LOGIN_FLOW_RETRYABLE_STATUS.has(response.status) || attempt === LOGIN_FLOW_RETRY_DELAYS_MS.length) {
        return response;
      }
      lastError = new Error(`retryable status ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === LOGIN_FLOW_RETRY_DELAYS_MS.length) {
        throw error;
      }
    }

    await sleep(LOGIN_FLOW_RETRY_DELAYS_MS[attempt]);
  }

  throw lastError || new Error("login flow request failed");
}

async function exchangeAuth1ForSession(auth1Token) {
  const attempts = [];
  const strategies = [
    {
      name: "策略A",
      headers: {
        "content-type": "application/proto",
        "connect-protocol-version": "1"
      },
      body: pbEncodeString(1, auth1Token)
    },
    {
      name: "策略B",
      headers: {
        "content-type": "application/proto",
        "connect-protocol-version": "1",
        "x-devin-auth1-token": auth1Token
      },
      body: new Uint8Array()
    }
  ];

  for (let i = 0; i < strategies.length; i++) {
    const attempt = await runPostAuthExchangeAttempt(strategies[i]);
    attempts.push(attempt);

    if (attempt.sessionToken) {
      return {
        sessionToken: attempt.sessionToken,
        accountId: attempt.accountId,
        orgId: attempt.orgId
      };
    }

    if (i === 0 && (attempt.status < 200 || attempt.status >= 300 || attempt.reason === "missing-session-token")) {
      continue;
    }
  }

  throw buildTokenExchangeError(attempts);
}

async function runPostAuthExchangeAttempt(strategy) {
  try {
    const response = await fetch(`${WINDSURF_API}/WindsurfPostAuth`, {
      method: "POST",
      headers: strategy.headers,
      body: strategy.body
    });
    const contentType = response.headers.get("content-type") || "";
    const body = new Uint8Array(await response.arrayBuffer());
    const summary = summarizeResponseBody(body, contentType);

    let sessionToken = null;
    let accountId = null;
    let orgId = null;
    if (body.length) {
      const postAuthRoot = pbDecode(body);
      sessionToken = pbString(postAuthRoot, 1);
      accountId = pbString(postAuthRoot, 4);
      orgId = pbString(postAuthRoot, 5);
    }

    return {
      name: strategy.name,
      status: response.status,
      contentType,
      summary,
      sessionToken,
      accountId,
      orgId,
      reason: sessionToken ? "ok" : "missing-session-token"
    };
  } catch (error) {
    return {
      name: strategy.name,
      status: 0,
      contentType: "",
      summary: truncateText(error.message || "network error"),
      sessionToken: null,
      accountId: null,
      orgId: null,
      reason: "network-error"
    };
  }
}

async function validateSessionAndBuildStorage(auth1Token) {
  const { sessionToken, accountId, orgId } = await exchangeAuth1ForSession(auth1Token);
  const localStorage = {
    devin_session_token: JSON.stringify(sessionToken),
    devin_account_id: accountId ? JSON.stringify(accountId) : "",
    devin_primary_org_id: orgId ? JSON.stringify(orgId) : "",
    devin_auth1_token: JSON.stringify(auth1Token)
  };

  const usage = await fetchUsageViaAPI(localStorage);
  if (usage.captureState === "not-found") {
    throw createLoginFlowError(
      "session token 已拿到，但当前 token 无法拉取用户信息或套餐信息。可改用浏览器登录 Windsurf 后点击“保存状态”",
      "SESSION_VALIDATION_FAILED"
    );
  }

  return { localStorage, usage };
}

function buildTokenExchangeError(attempts) {
  const detail = attempts
    .map((attempt) => {
      const statusLabel = attempt.status ? `HTTP ${attempt.status}` : "network error";
      const typeLabel = attempt.contentType || "unknown";
      return `${attempt.name}: ${statusLabel}, ${typeLabel}, ${attempt.summary}`;
    })
    .join("；");

  return createLoginFlowError(
    `Token 交换失败。${detail}。可改用浏览器登录 Windsurf 后点击“保存状态”`,
    "TOKEN_EXCHANGE_FAILED",
    { attempts }
  );
}

function createLoginFlowError(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

async function deleteSession(id) {
  const sessions = await getSessions();
  const next = sessions.filter((item) => item.id !== id);
  await saveSessions(next);
  return { deleted: true };
}

async function fetchUsageViaAPI(ls) {
  const token = parseStoredValue(ls?.devin_session_token);
  const accountId = parseStoredValue(ls?.devin_account_id);
  const orgId = parseStoredValue(ls?.devin_primary_org_id);
  const auth1 = parseStoredValue(ls?.devin_auth1_token);

  if (!token) return { captureState: "not-found" };

  const headers = {
    "content-type": "application/proto",
    "connect-protocol-version": "1",
    "x-devin-session-token": token,
    "x-auth-token": token,
    "x-devin-account-id": accountId || "",
    "x-devin-primary-org-id": orgId || "",
    "x-devin-auth1-token": auth1 || ""
  };
  const body = pbEncodeString(1, token);

  try {
    const [userRes, planRes] = await Promise.all([
      fetch(`${WINDSURF_API}/GetCurrentUser`, { method: "POST", headers, body }),
      fetch(`${WINDSURF_API}/GetPlanStatus`, { method: "POST", headers, body })
    ]);

    let profileEmail = null;
    if (userRes.ok) {
      const userBuf = new Uint8Array(await userRes.arrayBuffer());
      const userRoot = pbDecode(userBuf);
      const userMsg = pbFind(userRoot, 1);
      if (userMsg?.b) {
        profileEmail = pbString(pbDecode(userMsg.b), 3);
      }
    }

    let plan = null, planLabel = null, daysRemaining = null;
    let renewalDateText = null, renewalIso = null, remainingLabel = null;
    let dailyRemaining = 0, weeklyRemaining = 0;
    let dailyResetTs = null, weeklyResetTs = null;

    if (planRes.ok) {
      const planBuf = new Uint8Array(await planRes.arrayBuffer());
      const planRoot = pbDecode(planBuf);
      const outerMsg = pbFind(planRoot, 1);
      if (outerMsg?.b) {
        const outer = pbDecode(outerMsg.b);

        const planMsg = pbFind(outer, 1);
        if (planMsg?.b) {
          plan = pbString(pbDecode(planMsg.b), 2);
          planLabel = plan ? `${plan} plan` : null;
        }

        const endMsg = pbFind(outer, 3);
        if (endMsg?.b) {
          const ts = pbFind(pbDecode(endMsg.b), 1)?.v;
          if (ts) {
            const end = new Date(ts * 1000);
            renewalIso = end.toISOString();
            const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            renewalDateText = `${months[end.getUTCMonth()]} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
            daysRemaining = Math.ceil((end.getTime() - Date.now()) / 86400000);
            remainingLabel =
              daysRemaining < 0 ? `${Math.abs(daysRemaining)} day(s) overdue` :
              daysRemaining === 0 ? "renews today" :
              daysRemaining === 1 ? "1 day remaining" :
              `${daysRemaining} days remaining`;
          }
        }

        dailyRemaining = pbFind(outer, 14)?.v ?? 0;
        weeklyRemaining = pbFind(outer, 15)?.v ?? 0;
        dailyResetTs = pbFind(outer, 17)?.v ?? null;
        weeklyResetTs = pbFind(outer, 18)?.v ?? null;
      }
    }

    const quotas = [
      buildQuotaEntry("Daily quota", dailyRemaining, dailyResetTs),
      buildQuotaEntry("Weekly quota", weeklyRemaining, weeklyResetTs)
    ];

    return {
      profileEmail,
      plan,
      planLabel,
      renewalIso,
      renewalDateText,
      daysRemaining,
      remainingLabel,
      billingCycleDays: daysRemaining,
      billingCycleDate: renewalDateText,
      quotas,
      captureState: "stable",
      capturedAt: new Date().toISOString()
    };
  } catch (err) {
    return { captureState: "not-found", error: err.message };
  }
}

function buildQuotaEntry(label, remaining, resetTs) {
  return {
    label,
    remaining,
    used: Math.max(0, 100 - remaining),
    max: 100,
    remainingText: `${remaining}%`,
    usedText: `${100 - remaining}%`,
    resetTime: resetTs ? new Date(resetTs * 1000).toLocaleString() : null
  };
}

function parseStoredValue(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

function summarizeResponseBody(body, contentType) {
  if (!body?.length) return "empty body";

  if ((contentType || "").includes("application/proto")) {
    const parsed = pbDecode(body);
    const sessionToken = pbString(parsed, 1);
    if (sessionToken) {
      return `protobuf body (${body.length} bytes, session token returned)`;
    }
    return `protobuf body (${body.length} bytes, no session token)`;
  }

  const decoded = new TextDecoder()
    .decode(body)
    .replace(/\s+/g, " ")
    .trim();
  if (!decoded) return `body (${body.length} bytes)`;
  return truncateText(decoded);
}

function truncateText(text, maxLength = 200) {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function pbEncodeString(fieldNum, str) {
  const bytes = new TextEncoder().encode(str);
  const header = [];
  let v = (fieldNum << 3) | 2;
  while (v > 127) { header.push((v & 0x7f) | 0x80); v >>= 7; }
  header.push(v);
  v = bytes.length;
  while (v > 127) { header.push((v & 0x7f) | 0x80); v >>= 7; }
  header.push(v);
  const result = new Uint8Array(header.length + bytes.length);
  result.set(header);
  result.set(bytes, header.length);
  return result;
}

function pbDecode(buf) {
  const fields = [];
  let pos = 0;
  const len = buf.length;

  function readVarint() {
    let val = 0, shift = 0;
    while (pos < len) {
      const b = buf[pos++];
      val |= (b & 0x7f) << shift;
      shift += 7;
      if (!(b & 0x80)) break;
      if (shift > 35) break;
    }
    return val >>> 0;
  }

  while (pos < len) {
    try {
      const tag = readVarint();
      const fieldNum = tag >> 3;
      const wireType = tag & 7;
      if (fieldNum === 0 || fieldNum > 100000) break;

      if (wireType === 0) {
        const v = readVarint();
        fields.push({ f: fieldNum, v: v > 2147483647 ? v - 4294967296 : v });
      } else if (wireType === 2) {
        const blen = readVarint();
        if (blen > len - pos) break;
        fields.push({ f: fieldNum, b: buf.slice(pos, pos + blen) });
        pos += blen;
      } else if (wireType === 5) {
        if (pos + 4 > len) break;
        pos += 4;
      } else if (wireType === 1) {
        if (pos + 8 > len) break;
        pos += 8;
      } else {
        break;
      }
    } catch (e) { break; }
  }
  return fields;
}

function pbFind(fields, num) {
  return fields.find((f) => f.f === num);
}

function pbString(fields, num) {
  const f = pbFind(fields, num);
  return f?.b ? new TextDecoder().decode(f.b) : null;
}

function capturePageStorage() {
  const values = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key) continue;
    values[key] = window.localStorage.getItem(key);
  }

  return {
    localStorage: values,
    title: document.title,
    href: window.location.href
  };
}

function applyPageStorage(storedValues) {
  window.localStorage.clear();
  for (const [key, value] of Object.entries(storedValues)) {
    if (value === null || value === undefined) continue;
    window.localStorage.setItem(key, String(value));
  }
}

function buildCookieUrls(hostname) {
  const hosts = new Set([hostname, "windsurf.com", `.${hostname}`, ".windsurf.com"]);

  return Array.from(hosts)
    .filter(Boolean)
    .map((host) => `https://${host.startsWith(".") ? host.slice(1) : host}/`);
}

function dedupeCookies(cookies) {
  const map = new Map();
  for (const cookie of cookies) {
    const key = [cookie.domain, cookie.path, cookie.name, cookie.storeId].join("|");
    map.set(key, cookie);
  }
  return Array.from(map.values());
}

function serializeCookie(cookie) {
  return {
    domain: cookie.domain,
    expirationDate: cookie.expirationDate,
    httpOnly: cookie.httpOnly,
    name: cookie.name,
    path: cookie.path,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    storeId: cookie.storeId,
    value: cookie.value
  };
}

async function clearCookiesForHostname(hostname) {
  const cookieSets = await Promise.all(
    buildCookieUrls(hostname).map((url) => chrome.cookies.getAll({ url }))
  );

  const cookies = dedupeCookies(cookieSets.flat());
  for (const cookie of cookies) {
    await removeCookie(cookie);
  }
}

async function removeCookie(cookie) {
  const url = buildCookieRemovalUrl(cookie);
  await chrome.cookies.remove({
    url,
    name: cookie.name,
    storeId: cookie.storeId
  });
}

function buildCookieRemovalUrl(cookie) {
  const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  const path = cookie.path || "/";
  return `https://${domain}${path}`;
}

async function setCookie(cookie) {
  const details = {
    url: buildCookieRemovalUrl(cookie),
    domain: cookie.domain,
    expirationDate: cookie.expirationDate,
    httpOnly: cookie.httpOnly,
    name: cookie.name,
    path: cookie.path,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    storeId: cookie.storeId,
    value: cookie.value
  };

  await chrome.cookies.set(details);
}

async function ensureWindsurfTab(url) {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.id && tab.url && isWindsurfUrl(tab.url));

  if (existing?.id) {
    return chrome.tabs.update(existing.id, { active: true, url });
  }

  return chrome.tabs.create({ url, active: true });
}

async function waitForTabComplete(tabId) {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === "complete") {
    return;
  }

  await new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function findSessionIndexByEmail(sessions, normalizedEmail) {
  if (!normalizedEmail) return -1;
  return sessions.findIndex((session) => {
    return normalizeEmail(session?.usage?.profileEmail) === normalizedEmail
      || normalizeEmail(session?.name) === normalizedEmail;
  });
}

function normalizeEmail(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.includes("@") ? text : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
