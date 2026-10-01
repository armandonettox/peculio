import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Em desenvolvimento, as chamadas /api vao para o backend local
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    // Os testes de formulario digitam muitos campos; o primeiro de cada arquivo e mais lento com a suite toda rodando
    testTimeout: 15000,
    globals: true,
    setupFiles: "./src/test-setup.ts",
    // Os testes E2E (e2e/) sao do Playwright e rodam com `npm run e2e`
    exclude: ["**/node_modules/**", "e2e/**"],
  },
});
