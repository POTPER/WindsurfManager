import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Account, AddAccountParams, UpdateAccountParams } from "../api";
import * as api from "../api";

export const useAccountsStore = defineStore("accounts", () => {
  const accounts = ref<Account[]>([]);
  const loading = ref(false);
  const searchQuery = ref("");
  const selectedGroup = ref<string | null>(null);

  const filteredAccounts = computed(() => {
    let list = accounts.value;
    if (selectedGroup.value !== null) {
      list = list.filter((a) => a.group_name === selectedGroup.value);
    }
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase();
      list = list.filter(
        (a) =>
          a.email.toLowerCase().includes(q) ||
          a.nickname.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => a.sort_order - b.sort_order);
  });

  const groups = computed(() => {
    const set = new Set<string>();
    for (const a of accounts.value) {
      if (a.group_name) set.add(a.group_name);
    }
    return Array.from(set).sort();
  });

  async function fetchAll() {
    loading.value = true;
    try {
      accounts.value = await api.getAllAccounts();
    } finally {
      loading.value = false;
    }
  }

  async function add(params: AddAccountParams): Promise<Account> {
    const account = await api.addAccount(params);
    accounts.value.push(account);
    return account;
  }

  async function update(params: UpdateAccountParams) {
    await api.updateAccount(params);
    await fetchAll();
  }

  async function remove(id: string) {
    await api.deleteAccount(id);
    accounts.value = accounts.value.filter((a) => a.id !== id);
  }

  return {
    accounts,
    loading,
    searchQuery,
    selectedGroup,
    filteredAccounts,
    groups,
    fetchAll,
    add,
    update,
    remove,
  };
});
