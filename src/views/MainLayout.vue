<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  NLayout,
  NLayoutSider,
  NLayoutContent,
  NMenu,
  NInput,
  NButton,
  NSpace,
  NEmpty,
  NSpin,
  NIcon,
} from "naive-ui";
import {
  AddOutline,
  FolderOutline,
  ListOutline,
} from "@vicons/ionicons5";
import { useAccountsStore } from "../stores/accounts";
import { useTagsStore } from "../stores/tags";
import AccountCard from "../components/AccountCard.vue";
import AddAccountDialog from "../components/AddAccountDialog.vue";
import EditAccountDialog from "../components/EditAccountDialog.vue";
import type { Account } from "../api";

const accountsStore = useAccountsStore();
const tagsStore = useTagsStore();

const showAddDialog = ref(false);
const showEditDialog = ref(false);
const editingAccount = ref<Account | null>(null);

const menuValue = ref<string>("__all__");

onMounted(async () => {
  await Promise.all([accountsStore.fetchAll(), tagsStore.fetchAll()]);
});

function handleMenuUpdate(key: string) {
  menuValue.value = key;
  accountsStore.selectedGroup = key === "__all__" ? null : key;
}

function handleEdit(account: Account) {
  editingAccount.value = account;
  showEditDialog.value = true;
}

async function handleDelete(id: string) {
  await accountsStore.remove(id);
}

function renderIcon(icon: any) {
  return () => h(NIcon, null, { default: () => h(icon) });
}

import { h, computed } from "vue";

const menuOptions = computed(() => {
  const items: any[] = [
    {
      label: "全部账号",
      key: "__all__",
      icon: renderIcon(ListOutline),
    },
  ];
  for (const group of accountsStore.groups) {
    items.push({
      label: group,
      key: group,
      icon: renderIcon(FolderOutline),
    });
  }
  return items;
});
</script>

<template>
  <NLayout has-sider style="height: 100vh">
    <NLayoutSider
      bordered
      :width="200"
      content-style="padding: 12px;"
      :native-scrollbar="false"
    >
      <div style="font-size: 16px; font-weight: 700; padding: 8px 4px 16px; color: var(--n-text-color)">
        Windsurf Manager
      </div>
      <NMenu
        :value="menuValue"
        :options="menuOptions"
        @update:value="handleMenuUpdate"
      />
    </NLayoutSider>

    <NLayoutContent content-style="padding: 16px;" :native-scrollbar="false">
      <NSpace justify="space-between" align="center" style="margin-bottom: 16px">
        <NInput
          v-model:value="accountsStore.searchQuery"
          placeholder="搜索邮箱或昵称..."
          clearable
          style="width: 300px"
        />
        <NButton type="primary" @click="showAddDialog = true">
          <template #icon>
            <NIcon><AddOutline /></NIcon>
          </template>
          添加账号
        </NButton>
      </NSpace>

      <NSpin :show="accountsStore.loading">
        <div v-if="accountsStore.filteredAccounts.length">
          <AccountCard
            v-for="account in accountsStore.filteredAccounts"
            :key="account.id"
            :account="account"
            @edit="handleEdit"
            @delete="handleDelete"
          />
        </div>
        <NEmpty v-else description="暂无账号" />
      </NSpin>

      <AddAccountDialog v-model:show="showAddDialog" />
      <EditAccountDialog
        v-model:show="showEditDialog"
        :account="editingAccount"
      />
    </NLayoutContent>
  </NLayout>
</template>
