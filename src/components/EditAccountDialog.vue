<script setup lang="ts">
import { ref, watch, computed } from "vue";
import {
  NModal,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NButton,
  NSpace,
} from "naive-ui";
import { useAccountsStore } from "../stores/accounts";
import { useTagsStore } from "../stores/tags";
import type { Account } from "../api";

const props = defineProps<{
  show: boolean;
  account: Account | null;
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
}>();

const accountsStore = useAccountsStore();
const tagsStore = useTagsStore();

const form = ref({
  nickname: "",
  password: "",
  group_name: "",
  tags: [] as string[],
});

const loading = ref(false);

watch(
  () => props.account,
  (acc) => {
    if (acc) {
      form.value = {
        nickname: acc.nickname,
        password: acc.password,
        group_name: acc.group_name || "",
        tags: [...acc.tags],
      };
    }
  },
  { immediate: true }
);

const tagOptions = computed(() =>
  tagsStore.tags.map((t) => ({ label: t.name, value: t.name }))
);

async function handleSubmit() {
  if (!props.account) return;
  loading.value = true;
  try {
    await accountsStore.update({
      id: props.account.id,
      nickname: form.value.nickname,
      password: form.value.password,
      group_name: form.value.group_name || null,
      tags: form.value.tags,
    });
    emit("update:show", false);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <NModal
    :show="props.show"
    @update:show="emit('update:show', $event)"
    preset="card"
    title="编辑账号"
    style="width: 480px"
    :bordered="false"
    :mask-closable="false"
  >
    <NForm label-placement="left" label-width="80">
      <NFormItem label="邮箱">
        <NInput :value="account?.email" disabled />
      </NFormItem>
      <NFormItem label="密码">
        <NInput
          v-model:value="form.password"
          type="password"
          show-password-on="click"
          placeholder="密码"
        />
      </NFormItem>
      <NFormItem label="昵称">
        <NInput v-model:value="form.nickname" placeholder="昵称" />
      </NFormItem>
      <NFormItem label="分组">
        <NInput v-model:value="form.group_name" placeholder="分组名" />
      </NFormItem>
      <NFormItem label="标签">
        <NSelect
          v-model:value="form.tags"
          multiple
          :options="tagOptions"
          placeholder="选择标签"
        />
      </NFormItem>
    </NForm>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :loading="loading" @click="handleSubmit">
          保存
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>
