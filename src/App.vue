<script setup lang="ts">
import { NConfigProvider, darkTheme } from "naive-ui";
import MainLayout from "./views/MainLayout.vue";
</script>

<template>
  <NConfigProvider :theme="darkTheme">
    <MainLayout />
  </NConfigProvider>
</template>

<style>
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
  background: #1e1e1e;
}

#app {
  height: 100%;
}
</style>
