import { defineStore } from "pinia";
import { ref } from "vue";
import type { Tag } from "../api";
import * as api from "../api";

export const useTagsStore = defineStore("tags", () => {
  const tags = ref<Tag[]>([]);

  async function fetchAll() {
    tags.value = await api.getTags();
  }

  async function add(name: string, color: string) {
    await api.addTag(name, color);
    await fetchAll();
  }

  async function remove(name: string) {
    await api.deleteTag(name);
    tags.value = tags.value.filter((t) => t.name !== name);
  }

  return { tags, fetchAll, add, remove };
});
