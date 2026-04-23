import { invoke } from "@tauri-apps/api/core";

export interface Account {
  id: string;
  email: string;
  nickname: string;
  password: string;
  token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  auth_provider: string;
  devin_auth1_token: string | null;
  devin_account_id: string | null;
  devin_primary_org_id: string | null;
  group_name: string | null;
  sort_order: number;
  status: string;
  created_at: number;
  last_login_at: number | null;
  tags: string[];
}

export interface Tag {
  name: string;
  color: string;
}

export interface AddAccountParams {
  email: string;
  password: string;
  nickname: string;
  group_name: string | null;
  tags: string[];
}

export interface UpdateAccountParams {
  id: string;
  nickname?: string;
  password?: string;
  group_name?: string | null;
  tags?: string[];
  sort_order?: number;
}

// ---- Account commands ----

export function addAccount(params: AddAccountParams): Promise<Account> {
  return invoke("add_account", { params });
}

export function getAllAccounts(): Promise<Account[]> {
  return invoke("get_all_accounts");
}

export function getAccount(id: string): Promise<Account> {
  return invoke("get_account", { id });
}

export function updateAccount(params: UpdateAccountParams): Promise<void> {
  return invoke("update_account", { params });
}

export function deleteAccount(id: string): Promise<void> {
  return invoke("delete_account", { id });
}

// ---- Tag commands ----

export function getTags(): Promise<Tag[]> {
  return invoke("get_tags");
}

export function addTag(name: string, color: string): Promise<void> {
  return invoke("add_tag", { name, color });
}

export function deleteTag(name: string): Promise<void> {
  return invoke("delete_tag", { name });
}

// ---- Settings commands ----

export function getSettings(): Promise<Record<string, string>> {
  return invoke("get_settings");
}

export function updateSetting(key: string, value: string): Promise<void> {
  return invoke("update_setting", { key, value });
}
