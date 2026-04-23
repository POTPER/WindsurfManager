<script setup lang="ts">
import { ref, computed } from "vue";
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

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
}>();

const accountsStore = useAccountsStore();
const tagsStore = useTagsStore();

const form = ref({
  email: "",
  password: "",
  nickname: "",
  group_name: "",
  tags: [] as string[],
});

const loading = ref(false);

const tagOptions = computed(() =>
  tagsStore.tags.map((t) => ({ label: t.name, value: t.name }))
);

async function handleSubmit() {
  if (!form.value.email || !form.value.password) return;
  loading.value = true;
  try {
    await accountsStore.add({
      email: form.value.email,
      password: form.value.password,
      nickname: form.value.nickname,
      group_name: form.value.group_name || null,
      tags: form.value.tags,
    });
    emit("update:show", false);
    form.value = { email: "", password: "", nickname: "", group_name: "", tags: [] };
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
    title="添加账号"
    style="width: 480px"
    :bordered="false"
    :mask-closable="false"
  >
    <NForm label-placement="left" label-width="80">
      <NFormItem label="邮箱" required>
        <NInput v-model:value="form.email" placeholder="邮箱地址" />
      </NFormItem>
      <NFormItem label="密码" required>
        <NInput
          v-model:value="form.password"
          type="password"
          show-password-on="click"
          placeholder="密码"
        />
      </NFormItem>
      <NFormItem label="昵称">
        <NInput v-model:value="form.nickname" placeholder="可选昵称" />
      </NFormItem>
      <NFormItem label="分组">
        <NInput v-model:value="form.group_name" placeholder="可选分组名" />
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
          添加
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>
