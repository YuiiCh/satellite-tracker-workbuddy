import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import cesium from "vite-plugin-cesium";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), cesium()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
    // 本地开发时把 /api 代理到后端，避免硬编码地址
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
});
