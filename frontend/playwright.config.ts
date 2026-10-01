import { defineConfig, devices } from "@playwright/test";

// Os testes E2E rodam contra a stack completa (banco, backend e frontend em Docker).
// Use `npm run e2e`: ele sobe a stack, roda os testes e derruba tudo no final.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  // Os testes dependem da ordem (o primeiro cria o administrador), entao rodam um a um
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Fixa o tema do sistema para o resultado nao depender da maquina
    colorScheme: "light",
    locale: "pt-BR",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
