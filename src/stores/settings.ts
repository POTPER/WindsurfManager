import { defineStore } from "pinia";
import { ref } from "vue";
import * as api from "../api";

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<Record<string, string>>({});

  async function fetchAll() {
    settings.value = await api.getSettings();
  }

  async function set(key: string, value: string) {
    await api.updateSetting(key, value);
    settings.value[key] = value;
  }

  function get(key: string, fallback = ""): string {
    return settings.value[key] ?? fallback;
  }

  return { settings, fetchAll, set, get };
});
