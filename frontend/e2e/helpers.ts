import { createHmac } from "node:crypto";

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

// Entra pela tela de login e espera o painel aparecer. Se a aba ja tem sessao (o cookie de renovacao restaura sozinho,
// por exemplo depois de abrir a tela de novo no mesmo teste), o app pula o formulario e vai direto ao painel.
export async function loginAndWaitForDashboard(page: Page, user = ADMIN) {
  await page.goto("/login");
  const form = page.getByRole("button", { name: "Entrar" });
  const dashboard = page.getByRole("heading", { level: 1, name: "Painel" });
  await expect(form.or(dashboard)).toBeVisible();
  if (await form.isVisible()) await login(page, user);
  await expect(dashboard).toBeVisible();
}

// Configuracoes fica so no menu do usuario (nao tem mais item na sidebar), em abas: Perfil (padrao),
// Aparencia, Seguranca, Webhooks e, so para admin, Administracao (convites e contato de seguranca).
export async function openSettings(page: Page, tab?: "Aparência" | "Segurança" | "Webhooks" | "Administração") {
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await page.getByRole("menuitem", { name: "Configurações" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
  if (tab) await page.getByRole("tab", { name: tab, exact: true }).click();
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

// ---------- 2FA ----------

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
  let bits = "";
  for (const char of text.replace(/=+$/, "").toUpperCase()) bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

/** Codigo TOTP (RFC 6238, 6 digitos, passo de 30 s) de um segredo em base32, no instante `atMs`. */
export function totp(secret: string, atMs: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const hmac = createHmac("sha1", base32Decode(secret));
  hmac.write(counter);
  hmac.end();
  const digest = hmac.read() as Buffer;
  const offset = digest[digest.length - 1] & 0x0f;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}
