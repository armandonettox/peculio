import { expect, type APIRequestContext, type Page } from "@playwright/test";

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

// ---------- Dados criados direto pela API (para testar telas que listam coisas) ----------

export async function apiHeaders(request: APIRequestContext, user = ADMIN) {
  const login = await request.post("/api/v1/auth/login", { data: { email: user.email, password: user.password } });
  expect(login.status()).toBe(200);
  const { access_token: token } = await login.json();
  return { Authorization: `Bearer ${token}` };
}

export async function apiPost(
  request: APIRequestContext,
  headers: Record<string, string>,
  path: string,
  data: unknown,
) {
  const response = await request.post(`/api/v1${path}`, { headers, data });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
