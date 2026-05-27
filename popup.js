const toastContainer = document.querySelector("#toastContainer");
const refreshCountdown = document.querySelector("#refreshCountdown");
const sessionList = document.querySelector("#sessionList");
const smartSwitchBtn = document.querySelector("#smartSwitchBtn");
const template = document.querySelector("#sessionItemTemplate");

const exportJsonBtn = document.querySelector("#exportJsonBtn");
const importJsonBtn = document.querySelector("#importJsonBtn");
const importFileInput = document.querySelector("#importFileInput");

const captureSessionBtn = document.querySelector("#captureSessionBtn");
const loginToggle = document.querySelector("#loginToggle");
const loginModal = document.querySelector("#loginModal");
const loginCloseBtn = document.querySelector("#loginCloseBtn");
const loginBatch = document.querySelector("#loginBatch");
const loginParseBtn = document.querySelector("#loginParseBtn");
const loginSubmitBtn = document.querySelector("#loginSubmitBtn");
const batchProgress = document.querySelector("#batchProgress");
const batchLog = document.querySelector("#batchLog");

loginToggle.addEventListener("click", () => {
  loginModal.hidden = false;
  loginBatch.focus();
});

captureSessionBtn.addEventListener("click", async () => {
  await withBusyState(captureSessionBtn, async () => {
    const session = await sendMessage({ type: "captureSession" });
    setStatus(`已保存 ${session.name}`);
    await renderSessions();
    await renderCurrentAccount();
  });
});

loginCloseBtn.addEventListener("click", () => {
  if (!loginSubmitBtn.disabled) loginModal.hidden = true;
});

loginModal.addEventListener("click", (e) => {
  if (e.target === loginModal && !loginSubmitBtn.disabled) loginModal.hidden = true;
});

loginParseBtn.addEventListener("click", () => {
  const raw = loginBatch.value;
  const pairs = parseCredentials(raw);
  if (pairs.length) {
    loginBatch.value = pairs.map(p => `${p.email} ${p.password}`).join("\n");
    setStatus(`已整理出 ${pairs.length} 个账号`);
  } else {
    setStatus("未识别到有效的邮箱+密码", true);
  }
});

loginSubmitBtn.addEventListener("click", handleBatchLoginSubmit);

async function handleBatchLoginSubmit() {
  const lines = loginBatch.value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return;

  const accounts = lines
    .map((line) => {
      const idx = line.indexOf(" ");
      if (idx === -1) return null;
      return {
        email: line.substring(0, idx).trim(),
        password: line.substring(idx + 1).trim()
      };
    })
    .filter(Boolean);

  if (!accounts.length) {
    setStatus("格式错误：每行需要“邮箱 密码”", true);
    return;
  }

  const sessions = await sendMessage({ type: "getSessions" }, { silentError: true }).catch(() => []);
  const existingEmails = new Set();
  for (const session of sessions) {
    const emailKey = getSessionEmailKey(session);
    if (emailKey) existingEmails.add(emailKey);
  }
  const seenInBatch = new Set();

  loginSubmitBtn.disabled = true;
  loginParseBtn.disabled = true;
  loginBatch.disabled = true;
  batchLog.hidden = false;
  batchLog.innerHTML = "";
  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (let i = 0; i < accounts.length; i++) {
    const { email, password } = accounts[i];
    const normalizedEmail = normalizeEmail(email);
    batchProgress.textContent = `(${i + 1}/${accounts.length})`;

    const row = document.createElement("div");
    row.className = "batch-log-row";
    row.innerHTML = `<span class="batch-log-email">${email}</span><span class="batch-log-status batch-log-pending">登录中...</span>`;
    batchLog.appendChild(row);
    batchLog.scrollTop = batchLog.scrollHeight;
    const statusEl = row.querySelector(".batch-log-status");

    if (seenInBatch.has(normalizedEmail)) {
      skipped++;
      statusEl.textContent = "本批重复，已跳过";
      statusEl.className = "batch-log-status batch-log-ok";
      continue;
    }
    seenInBatch.add(normalizedEmail);

    if (existingEmails.has(normalizedEmail)) {
      skipped++;
      statusEl.textContent = "已存在，已跳过";
      statusEl.className = "batch-log-status batch-log-ok";
      continue;
    }

    try {
      await sendMessage({ type: "addAccountViaLogin", email, password }, { silentError: true });
      ok++;
      existingEmails.add(normalizedEmail);
      statusEl.textContent = "成功";
      statusEl.className = "batch-log-status batch-log-ok";
      setStatus(`已导入 ${email}`);
    } catch (error) {
      fail++;
      const errMsg = error.message || "导入失败";
      statusEl.textContent = errMsg;
      statusEl.className = "batch-log-status batch-log-fail";
      const toastMsg = shouldUseCompactBatchError(errMsg) ? "登录失败，请查看详情" : errMsg;
      setStatus(`${email}: ${toastMsg}`, true);
    }

    if (i < accounts.length - 1) {
      await sleep(getBatchPauseMs(statusEl.textContent));
    }
  }

  loginSubmitBtn.disabled = false;
  loginParseBtn.disabled = false;
  loginBatch.disabled = false;
  batchProgress.textContent = "";
  loginBatch.value = "";
  setStatus(`批量完成：成功 ${ok}，跳过 ${skipped}，失败 ${fail}`);
  await renderSessions();
}

exportJsonBtn.addEventListener("click", async () => {
  const sessions = await sendMessage({ type: "getSessions" });
  const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `windsurf-sessions-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`已导出 ${sessions.length} 个账号`);
});

importJsonBtn.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error("文件格式错误");
    const existing = await sendMessage({ type: "getSessions" });
    const existingEmails = new Set(existing.map((s) => s.usage?.profileEmail).filter(Boolean));
    let added = 0;
    for (const s of imported) {
      if (!s.id || !s.name) continue;
      if (s.usage?.profileEmail && existingEmails.has(s.usage.profileEmail)) continue;
      existing.push(s);
      added++;
    }
    await sendMessage({ type: "importSessions", sessions: existing });
    setStatus(`已导入 ${added} 个新账号（跳过 ${imported.length - added} 个重复）`);
    await renderSessions();
  } catch (err) {
    setStatus("导入失败：" + err.message, true);
  }
  importFileInput.value = "";
});

let _countdownInterval = null;
async function startCountdown() {
  if (_countdownInterval) clearInterval(_countdownInterval);
  const nextTime = await sendMessage({ type: "getNextRefresh" }).catch(() => null);
  if (!nextTime) { refreshCountdown.textContent = ""; return; }
  function tick() {
    const diff = Math.max(0, Math.round((nextTime - Date.now()) / 1000));
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    refreshCountdown.textContent = `${m}:${String(s).padStart(2, "0")} 后刷新`;
    if (diff <= 0) {
      clearInterval(_countdownInterval);
      refreshCountdown.textContent = "刷新中...";
      setTimeout(async () => {
        await renderSessions();
        startCountdown();
      }, 3000);
    }
  }
  tick();
  _countdownInterval = setInterval(tick, 1000);
}
startCountdown();

smartSwitchBtn.addEventListener("click", async () => {
  await withBusyState(smartSwitchBtn, async () => {
    const sessions = await sendMessage({ type: "getSessions" });
    const currentAccount = await sendMessage({ type: "getCurrentAccount" }).catch(() => null);
    const currentEmail = currentAccount?.usage?.profileEmail;

    const available = sessions.filter((s) => {
      const plan = ((s.usage?.planLabel || s.usage?.plan) || "").toLowerCase();
      if (plan.includes("free") || (!plan.includes("trial") && !plan.includes("pro") && !plan.includes("max") && !plan.includes("team"))) return false;
      const daily = (s.usage?.quotas || []).find((q) => q.label === "Daily quota")?.remaining ?? 0;
      const weekly = (s.usage?.quotas || []).find((q) => q.label === "Weekly quota")?.remaining ?? 0;
      const daysLeft = s.usage?.billingCycleDays ?? s.usage?.daysRemaining ?? 99;
      if (daily <= 0 || weekly <= 0 || daysLeft <= 0) return false;
      return true;
    });

    if (!available.length) {
      setStatus("没有可用的试用账号", true);
      return;
    }

    const scored = available.map((s) => {
      const daily = (s.usage?.quotas || []).find((q) => q.label === "Daily quota")?.remaining ?? 0;
      const weekly = (s.usage?.quotas || []).find((q) => q.label === "Weekly quota")?.remaining ?? 0;
      const daysLeft = s.usage?.billingCycleDays ?? s.usage?.daysRemaining ?? 99;
      const isCurrent = currentEmail && s.usage?.profileEmail === currentEmail;

      const urgencyBonus = daysLeft <= 7 ? (8 - daysLeft) * 20 : 0;
      const dailyScore = daily;
      const weeklyPenalty = weekly < 30 ? -(30 - weekly) : 0;
      const rotationBonus = isCurrent ? 0 : 15;
      const score = urgencyBonus + dailyScore + weeklyPenalty + rotationBonus;

      return { session: s, score, daily, weekly, daysLeft, urgencyBonus };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const s = best.session;
    const mode = best.urgencyBonus > 0 ? "🎯 试用优先" : "� 轮换切换";
    await sendMessage({ type: "restoreSession", id: s.id });
    const info = best.urgencyBonus > 0
      ? `${mode} → ${s.name}（日${best.daily}%·周${best.weekly}%·剩${best.daysLeft}天）`
      : `${mode} → ${s.name}（日${best.daily}%·周${best.weekly}%）`;
    setStatus(info);
    await renderSessions();
    renderCurrentAccount();
  });
});

const currentAccountSection = document.querySelector("#currentAccountSection");
const currentPlanBadge = document.querySelector("#currentPlanBadge");
const currentDaily = document.querySelector("#currentDaily");
const currentWeekly = document.querySelector("#currentWeekly");
const currentDays = document.querySelector("#currentDays");
const currentAccountName = document.querySelector("#currentAccountName");

async function renderCurrentAccount() {
  try {
    const account = await sendMessage({ type: "getCurrentAccount" });
    if (!account) {
      currentAccountSection.hidden = true;
      return;
    }
    const usage = account.usage || {};
    applyPlanBadge(currentPlanBadge, usage.plan);
    const dailyQuota = (usage.quotas || []).find((q) => q.label === "Daily quota");
    const weeklyQuota = (usage.quotas || []).find((q) => q.label === "Weekly quota");
    applyQuotaRing(currentDaily, dailyQuota);
    applyQuotaRing(currentWeekly, weeklyQuota);
    const daysLeft = usage.billingCycleDays ?? usage.daysRemaining ?? null;
    applyDaysRing(currentDays, daysLeft);
    currentAccountName.textContent = account.name || usage.profileEmail || "–";
    currentAccountSection.hidden = false;
  } catch (_) {
    currentAccountSection.hidden = true;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await renderSessions();
  renderCurrentAccount();
  startAutoRefresh();
});

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(async () => {
    try {
      await renderSessions();
      setStatus(`自动刷新于 ${formatTime(new Date())}`);
    } catch (_) {}
  }, AUTO_REFRESH_INTERVAL_MS);
}

async function renderSessions() {
  const sessions = await sendMessage({ type: "getSessions" });
  sessionList.innerHTML = "";

  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent =
      "还没有保存的账号。请点击「+ 登录」批量添加，或「+ 保存」捕获当前会话。";
    sessionList.appendChild(empty);
    return;
  }

  const planOrder = { pro: 0, trial: 1, free: 2, unknown: 3 };
  function getPlanGroup(session) {
    const p = ((session.usage?.planLabel || session.usage?.plan) || "").toLowerCase();
    if (p.includes("pro") || p.includes("max") || p.includes("team") || p.includes("enterprise")) return "pro";
    if (p.includes("trial")) return "trial";
    if (p.includes("free")) return "free";
    return "unknown";
  }
  function getDailyRemaining(session) {
    const q = (session.usage?.quotas || []).find((q) => q.label === "Daily quota");
    return q?.remaining ?? -1;
  }

  function getDaysLeft(session) {
    return session.usage?.billingCycleDays ?? session.usage?.daysRemaining ?? 99;
  }
  function getWeeklyRemaining(session) {
    const q = (session.usage?.quotas || []).find((q) => q.label === "Weekly quota");
    return q?.remaining ?? -1;
  }

  function getSortTier(session) {
    const daily = getDailyRemaining(session);
    const weekly = getWeeklyRemaining(session);
    if (daily === 0) return 2;
    if (weekly >= 0 && weekly < 10) return 1;
    return 0;
  }

  const hoursLeft = getHoursUntilSundayReset();
  const nearReset = hoursLeft <= 24;

  const grouped = {};
  for (const s of sessions) {
    const g = getPlanGroup(s);
    (grouped[g] = grouped[g] || []).push(s);
  }
  for (const g of Object.keys(grouped)) {
    grouped[g].sort((a, b) => {
      const ta = getSortTier(a), tb = getSortTier(b);
      if (ta !== tb) return ta - tb;
      if (g === "trial") {
        const da = getDaysLeft(a), db = getDaysLeft(b);
        if (da !== db) return da - db;
      }
      if (nearReset) {
        const wa = getWeeklyRemaining(a), wb = getWeeklyRemaining(b);
        if (wa !== wb) return wb - wa;
      }
      return getDailyRemaining(b) - getDailyRemaining(a);
    });
  }

  const sortedGroups = Object.keys(grouped).sort((a, b) => (planOrder[a] ?? 3) - (planOrder[b] ?? 3));
  const groupLabels = { pro: "Pro", trial: "Free Trial", free: "Free", unknown: "未知" };
  const PAGE_SIZE = 5;

  for (const group of sortedGroups) {
    const items = grouped[group];
    const groupBox = document.createElement("div");
    groupBox.className = "group-box";
    const header = document.createElement("div");
    header.className = "group-header";
    const headerLabel = document.createElement("span");
    headerLabel.className = "group-header-label";
    headerLabel.textContent = `${groupLabels[group] || group} (${items.length})`;
    header.appendChild(headerLabel);
    groupBox.appendChild(header);
    sessionList.appendChild(groupBox);

    const cardContainer = document.createElement("div");
    cardContainer.className = "group-cards";
    groupBox.appendChild(cardContainer);

    const cards = [];
    for (let i = 0; i < items.length; i++) {
      const session = items[i];
      const fragment = template.content.cloneNode(true);
      const root = fragment.querySelector(".session-card");
      const nameEl = fragment.querySelector(".session-name");
      const dailyEl = fragment.querySelector(".usage-daily");
      const weeklyEl = fragment.querySelector(".usage-weekly");
      const timeEl = fragment.querySelector(".usage-time");
      const daysRingEl = fragment.querySelector(".usage-days");
      const restoreButton = fragment.querySelector(".action-restore");
      const planBadge = fragment.querySelector(".plan-badge");

      nameEl.textContent = session.name;
      timeEl.textContent = formatShortDate(session.updatedAt);

      if (session.tokenExpired) {
        root.classList.add("card-expired");
        nameEl.textContent = session.name + " (失效)";
      }

      const usage = session.usage || {};
      applyPlanBadge(planBadge, usage.plan);

      const daysLeft = usage.billingCycleDays ?? usage.daysRemaining ?? null;
      applyDaysRing(daysRingEl, daysLeft);

      const dailyQuota = (usage.quotas || []).find((q) => q.label === "Daily quota");
      const weeklyQuota = (usage.quotas || []).find((q) => q.label === "Weekly quota");
      applyQuotaRing(dailyEl, dailyQuota);
      applyQuotaRing(weeklyEl, weeklyQuota);

      let longPressTimer = null;
      function exitDeleteMode() {
        root.classList.remove("card-delete-mode");
        const btn = root.querySelector(".card-delete-btn");
        if (btn) btn.remove();
      }
      root.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          if (root.classList.contains("card-delete-mode")) return;
          root.classList.add("card-delete-mode");
          const xBtn = document.createElement("button");
          xBtn.className = "card-delete-btn";
          xBtn.textContent = "✕";
          xBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            showDeleteConfirm(session, () => exitDeleteMode());
          });
          root.appendChild(xBtn);
          const dismiss = (ev) => {
            if (root.contains(ev.target)) return;
            exitDeleteMode();
            document.removeEventListener("pointerdown", dismiss, true);
          };
          setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
        }, 800);
      });
      root.addEventListener("pointerup", () => { if (longPressTimer) clearTimeout(longPressTimer); });
      root.addEventListener("pointerleave", () => { if (longPressTimer) clearTimeout(longPressTimer); });

      restoreButton.addEventListener("click", async () => {
        await withBusyState(restoreButton, async () => {
          const result = await sendMessage({ type: "restoreSession", id: session.id });
          const remainingLabel = result?.usage?.remainingLabel ? ` (${result.usage.remainingLabel})` : "";
          setStatus(`已切换到 ${session.name}${remainingLabel}`);
          await renderSessions();
        });
      });

      cards.push(root);
    }

    const totalPages = Math.ceil(cards.length / PAGE_SIZE);
    let currentPage = 0;

    function showPage(page) {
      cardContainer.innerHTML = "";
      const start = page * PAGE_SIZE;
      const end = Math.min(start + PAGE_SIZE, cards.length);
      for (let i = start; i < end; i++) {
        cards[i].style.animationDelay = `${(i - start) * 0.04}s`;
        cardContainer.appendChild(cards[i]);
      }
      if (pagerEl) {
        pageLabel.textContent = `${page + 1} / ${totalPages}`;
        prevBtn.disabled = page === 0;
        nextBtn.disabled = page === totalPages - 1;
      }
    }

    let pagerEl = null, pageLabel = null, prevBtn = null, nextBtn = null;
    if (totalPages > 1) {
      pagerEl = document.createElement("div");
      pagerEl.className = "group-pager";
      prevBtn = document.createElement("button");
      prevBtn.className = "pager-btn";
      prevBtn.textContent = "‹";
      prevBtn.addEventListener("click", () => { currentPage--; showPage(currentPage); });
      nextBtn = document.createElement("button");
      nextBtn.className = "pager-btn";
      nextBtn.textContent = "›";
      nextBtn.addEventListener("click", () => { currentPage++; showPage(currentPage); });
      pageLabel = document.createElement("span");
      pageLabel.className = "pager-label";
      pagerEl.appendChild(prevBtn);
      pagerEl.appendChild(pageLabel);
      pagerEl.appendChild(nextBtn);
      header.appendChild(pagerEl);
    }

    showPage(0);
  }
}

function applyQuotaRing(container, quota) {
  const fg = container.querySelector(".ring-fg");
  const pct = container.querySelector(".ring-pct");
  const circumference = 2 * Math.PI * 15.5;

  if (!quota) {
    pct.textContent = "–";
    fg.style.strokeDasharray = `0 ${circumference}`;
    container.title = "";
    return;
  }

  const remaining = quota.remaining ?? 0;
  const filled = (remaining / 100) * circumference;
  fg.style.strokeDasharray = `${filled} ${circumference}`;

  pct.textContent = `${remaining}%`;
  container.title = quota.resetTime ? `重置: ${quota.resetTime}` : "";

  fg.classList.remove("ring-warn", "ring-danger");
  pct.classList.remove("ring-text-warn", "ring-text-danger");
  if (remaining <= 10) {
    fg.classList.add("ring-danger");
    pct.classList.add("ring-text-danger");
  } else if (remaining <= 30) {
    fg.classList.add("ring-warn");
    pct.classList.add("ring-text-warn");
  }
}

function applyDaysRing(container, days) {
  const fg = container.querySelector(".ring-fg");
  const pct = container.querySelector(".ring-pct");
  const circumference = 2 * Math.PI * 15.5;
  const maxDays = 14;

  if (days === null || days === undefined) {
    pct.textContent = "–";
    fg.style.strokeDasharray = `0 ${circumference}`;
    container.title = "";
    return;
  }

  const ratio = Math.min(days / maxDays, 1);
  fg.style.strokeDasharray = `${ratio * circumference} ${circumference}`;
  pct.textContent = days;
  container.title = `剩余 ${days} 天`;

  fg.classList.remove("ring-warn", "ring-danger");
  pct.classList.remove("ring-text-warn", "ring-text-danger");
  if (days <= 2) {
    fg.classList.add("ring-danger");
    pct.classList.add("ring-text-danger");
  } else if (days <= 5) {
    fg.classList.add("ring-warn");
    pct.classList.add("ring-text-warn");
  }
}

function showDeleteConfirm(session, onCancel) {
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  const box = document.createElement("div");
  box.className = "confirm-box";
  box.innerHTML = `
    <div class="confirm-msg">确定删除「${session.name}」吗？</div>
    <div class="confirm-actions">
      <button class="confirm-cancel" type="button">取消</button>
      <button class="confirm-delete" type="button">删除</button>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const close = () => { overlay.remove(); if (onCancel) onCancel(); };
  box.querySelector(".confirm-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  box.querySelector(".confirm-delete").addEventListener("click", async () => {
    overlay.remove();
    await sendMessage({ type: "deleteSession", id: session.id });
    setStatus(`已删除：${session.name}`);
    await renderSessions();
  });
}

async function sendMessage(message, options = {}) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    const errorMessage = response?.error || "Unknown error";
    if (!options.silentError) {
      setStatus(errorMessage, true);
    }
    throw new Error(errorMessage);
  }
  return response.result;
}

function setStatus(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = "toast" + (isError ? " toast-error" : "");
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => toast.remove());
  }, 3000);
}

async function withBusyState(button, work) {
  button.disabled = true;
  try {
    await work();
  } finally {
    button.disabled = false;
  }
}

function formatShortDate(value) {
  const d = new Date(value);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function shouldUseCompactBatchError(message) {
  return message.length > 72 || message.includes("可改用浏览器登录");
}

function getSessionEmailKey(session) {
  const candidates = [session?.usage?.profileEmail, session?.name];
  for (const candidate of candidates) {
    const normalized = normalizeEmail(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeEmail(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.includes("@") ? text : "";
}

function getBatchPauseMs(statusText) {
  if (!statusText) return 450;
  if (statusText.includes("过于频繁") || statusText.includes("无法检查账号状态")) return 1800;
  return 450;
}

function parseCredentials(text) {
  const emailRe = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  const results = [];
  const seen = new Set();
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const sepMatch = line.match(/([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\s*[-]{2,}\s*(\S+)/);
    if (sepMatch) { addPair(sepMatch[1], sepMatch[2]); continue; }

    const spaceMatch = line.match(/([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\s+(\S+)/);
    if (spaceMatch) { addPair(spaceMatch[1], spaceMatch[2]); continue; }

    const labelPwdMatch = line.match(/(?:密码|password)\s*[：:]\s*(\S+)/i);
    if (labelPwdMatch) {
      for (let j = Math.max(0, i - 3); j < i; j++) {
        const em = lines[j].match(emailRe);
        if (em) { addPair(em[em.length - 1], labelPwdMatch[1]); break; }
      }
      continue;
    }

    const labelAccMatch = line.match(/(?:账号密码|账号空格密码)\s*[：:]\s*([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\s+(\S+)/);
    if (labelAccMatch) { addPair(labelAccMatch[1], labelAccMatch[2]); continue; }
  }

  function addPair(email, password) {
    const key = email.toLowerCase();
    if (!seen.has(key)) { seen.add(key); results.push({ email, password }); }
  }
  return results;
}

function applyPlanBadge(el, plan) {
  el.classList.remove("plan-pro", "plan-trial", "plan-free");
  const p = (plan || "").toLowerCase();
  if (p.includes("pro") || p.includes("max") || p.includes("team") || p.includes("enterprise")) {
    el.classList.add("plan-pro");
  } else if (p.includes("trial")) {
    el.classList.add("plan-trial");
  } else {
    el.classList.add("plan-free");
  }
  el.textContent = plan || "–";
}

function getHoursUntilSundayReset() {
  const now = new Date();
  const day = now.getDay();
  let daysUntilSunday = (7 - day) % 7;
  if (daysUntilSunday === 0) {
    if (now.getHours() >= 16) {
      daysUntilSunday = 7;
    }
  }
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + daysUntilSunday);
  nextSunday.setHours(16, 0, 0, 0);
  return Math.max(0, (nextSunday - now) / (1000 * 60 * 60));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
