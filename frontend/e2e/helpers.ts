import { expect, type Page } from "@playwright/test";

// Dados ficticios. O primeiro teste cria o administrador; os seguintes reutilizam a conta.
export const ADMIN = { name: "Ana Teste", email: "ana@example.com", password: "SenhaForte123" };
export const GUEST = { name: "Bruno Convidado", email: "bruno@example.com", password: "OutraSenha456" };

// getByLabel("Senha") tambem acharia o botao "Mostrar senha", por isso o exact
export const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

export async function login(page: Page, { email, password }: { email: string; password: string }) {
  await field(page, "E-mail").fill(email);
  await field(page, "Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

// Entra pela tela de login e espera o painel aparecer
export async function loginAndWaitForDashboard(page: Page, user = ADMIN) {
  await page.goto("/login");
  await login(page, user);
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
}
