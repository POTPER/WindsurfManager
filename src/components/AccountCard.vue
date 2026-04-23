<script setup lang="ts">
import { NCard, NTag, NSpace, NButton, NPopconfirm } from "naive-ui";
import { TrashOutline, CreateOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import type { Account } from "../api";

const props = defineProps<{
  account: Account;
}>();

const emit = defineEmits<{
  edit: [account: Account];
  delete: [id: string];
}>();

function statusType(status: string): "success" | "warning" | "error" | "info" {
  switch (status) {
    case "active":
      return "success";
    case "expired":
      return "error";
    case "refreshing":
      return "warning";
    default:
      return "info";
  }
}
</script>

<template>
  <NCard size="small" hoverable style="margin-bottom: 8px">
    <template #header>
      <div style="display: flex; align-items: center; gap: 8px">
        <span style="font-weight: 600">{{ account.nickname || account.email }}</span>
        <NTag :type="statusType(account.status)" size="small" round>
          {{ account.status }}
        </NTag>
      </div>
    </template>
    <template #header-extra>
      <NSpace :size="4">
        <NButton quaternary size="small" @click="emit('edit', account)">
          <template #icon>
            <NIcon><CreateOutline /></NIcon>
          </template>
        </NButton>
        <NPopconfirm @positive-click="emit('delete', account.id)">
          <template #trigger>
            <NButton quaternary size="small" type="error">
              <template #icon>
                <NIcon><TrashOutline /></NIcon>
              </template>
            </NButton>
          </template>
          确认删除此账号？
        </NPopconfirm>
      </NSpace>
    </template>

    <div style="color: var(--n-text-color-3); font-size: 13px">
      {{ account.email }}
    </div>

    <div v-if="account.group_name" style="margin-top: 6px; font-size: 12px; color: var(--n-text-color-3)">
      分组: {{ account.group_name }}
    </div>

    <NSpace v-if="account.tags.length" style="margin-top: 6px" :size="4">
      <NTag v-for="tag in account.tags" :key="tag" size="small" round>
        {{ tag }}
      </NTag>
    </NSpace>
  </NCard>
</template>
