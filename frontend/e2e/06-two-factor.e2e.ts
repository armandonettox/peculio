import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, field, openSettings, totp } from "./helpers";

// Roda depois do 01 (que cria o administrador). Usa um usuario so deste arquivo para nao
// interferir nos outros: o 2FA muda o login dele. Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const USER = { name: "Carla Dois Fatores", email: "carla@example.com", password: "SenhaDeCarla789" };

// O que um passo descobre e os seguintes usam
const saved = { secret: "", usedCode: "", recovery: [] as string[] };

const dialog = (page: Page) => page.getByRole("dialog");

async function signIn(page: Page) {
  await page.goto("/login");
  await field(page, "E-mail").fill(USER.email);
  await field(page, "Senha").fill(USER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
}

async function openSecurity(page: Page) {
  await openSettings(page, "Segurança");
  await expect(page.getByRole("heading", { level: 2, name: "Verificação em duas etapas" })).toBeVisible();
}

async function enterSecondStep(page: Page) {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Verificação em duas etapas" })).toBeVisible();
}

test("prepara o usuario pela API (convite do administrador)", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const invite = await request.post("/api/v1/invites", { headers, data: { email: USER.email } });
  expect(invite.status()).toBe(201);
  const { token } = await invite.json();
  const created = await request.post("/api/v1/auth/register", {
    data: { name: USER.name, email: USER.email, password: USER.password, invite_token: token },
  });
  expect(created.status()).toBe(201);
});

test("ativa o 2FA pela tela de seguranca e guarda os codigos de recuperacao", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
  await openSecurity(page);
  await expect(page.getByText("Desativada")).toBeVisible();

  await page.getByRole("button", { name: "Ativar verificação em duas etapas" }).click();
  await expect(dialog(page).getByRole("img", { name: "QR code para o app autenticador" })).toBeVisible();
  saved.secret = (await dialog(page).getByLabel("Segredo").innerText()).trim();
  expect(saved.secret).toMatch(/^[A-Z2-7]{16,}$/);

  // Codigo errado primeiro: o erro aparece e a tela continua
  await dialog(page).getByLabel("Código de verificação").fill("000000");
  await dialog(page).getByRole("button", { name: "Ativar" }).click();
  await expect(dialog(page).getByText(/Código inválido/)).toBeVisible();

  await dialog(page).getByLabel("Código de verificação").fill(totp(saved.secret));
  await dialog(page).getByRole("button", { name: "Ativar" }).click();

  const list = dialog(page).getByRole("list", { name: "Códigos de recuperação" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  saved.recovery = (await list.getByRole("listitem").allInnerTexts()).map((text) => text.trim());
  expect(saved.recovery.every((code) => /^[0-9a-f]{6}-[0-9a-f]{6}$/.test(code))).toBe(true);

  // Nao fecha com Esc antes de confirmar que guardou
  await page.keyboard.press("Escape");
  await expect(list).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Concluir" })).toBeDisabled();
  await dialog(page).getByLabel("Guardei meus códigos em um lugar seguro").check();
  await dialog(page).getByRole("button", { name: "Concluir" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText("Ativada")).toBeVisible();
  await expect(page.getByText("10 códigos de recuperação restantes")).toBeVisible();
});

test("com o 2FA ligado, a senha sozinha nao entra: pede o codigo do app", async ({ page }) => {
  await enterSecondStep(page);
  // Nao ha sessao ainda: o painel nao aparece
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toHaveCount(0);

  // Codigo errado
  await field(page, "Código de verificação").fill("000000");
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("alert")).toContainText("Código inválido");

  // O codigo do passo seguinte (o atual ja foi gasto ao ativar) vale pela janela de tolerancia
  saved.usedCode = totp(saved.secret, Date.now() + 30_000);
  await field(page, "Código de verificação").fill(saved.usedCode);
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
});

test("o mesmo codigo do app nao vale duas vezes", async ({ page }) => {
  await enterSecondStep(page);
  // Exatamente o codigo do teste anterior: ainda esta na janela de tolerancia, mas ja foi gasto
  await field(page, "Código de verificação").fill(saved.usedCode);
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("alert")).toContainText("Código inválido");
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toHaveCount(0);
});

test("um codigo de recuperacao entra uma vez so", async ({ page }) => {
  await enterSecondStep(page);
  await page.getByRole("button", { name: "Usar um código de recuperação" }).click();
  await field(page, "Código de recuperação").fill(saved.recovery[0]);
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();

  await openSecurity(page);
  await expect(page.getByText("9 códigos de recuperação restantes")).toBeVisible();
  await signOut(page);

  // O mesmo codigo outra vez: recusado
  await enterSecondStep(page);
  await page.getByRole("button", { name: "Usar um código de recuperação" }).click();
  await field(page, "Código de recuperação").fill(saved.recovery[0]);
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("alert")).toContainText("Código inválido");
});

test("voltar do segundo passo leva de novo a senha", async ({ page }) => {
  await enterSecondStep(page);
  await page.getByRole("button", { name: "Voltar" }).click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(field(page, "E-mail")).toHaveValue(USER.email);
  await expect(field(page, "Senha")).toHaveValue("");
});

test("gerar novos codigos pede senha e codigo, e os antigos deixam de valer", async ({ page }) => {
  await enterSecondStep(page);
  await page.getByRole("button", { name: "Usar um código de recuperação" }).click();
  await field(page, "Código de recuperação").fill(saved.recovery[1]);
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
  await openSecurity(page);
  await expect(page.getByText("8 códigos de recuperação restantes")).toBeVisible();

  await page.getByRole("button", { name: "Gerar novos códigos" }).click();
  // Senha errada: erro no campo, nada muda
  await dialog(page).getByLabel("Senha", { exact: true }).fill("errada");
  await dialog(page).getByLabel("Código de verificação").fill(saved.recovery[2]);
  await dialog(page).getByRole("button", { name: "Gerar novos códigos" }).click();
  await expect(dialog(page).getByText("Senha incorreta.")).toBeVisible();

  await dialog(page).getByLabel("Senha", { exact: true }).fill(USER.password);
  await dialog(page).getByRole("button", { name: "Gerar novos códigos" }).click();
  const list = dialog(page).getByRole("list", { name: "Códigos de recuperação" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const fresh = (await list.getByRole("listitem").allInnerTexts()).map((text) => text.trim());
  expect(fresh.some((code) => saved.recovery.includes(code))).toBe(false);
  await dialog(page).getByLabel("Guardei meus códigos em um lugar seguro").check();
  await dialog(page).getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByText("10 códigos de recuperação restantes")).toBeVisible();

  // Um codigo antigo que sobrou nao entra mais
  await signOut(page);
  await enterSecondStep(page);
  await page.getByRole("button", { name: "Usar um código de recuperação" }).click();
  await field(page, "Código de recuperação").fill(saved.recovery[3]);
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("alert")).toContainText("Código inválido");

  saved.recovery = fresh;
});

test("desativar pede senha e codigo, e o login volta a ser so com a senha", async ({ page }) => {
  await enterSecondStep(page);
  await page.getByRole("button", { name: "Usar um código de recuperação" }).click();
  await field(page, "Código de recuperação").fill(saved.recovery[0]);
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
  await openSecurity(page);

  await page.getByRole("button", { name: "Desativar", exact: true }).click();
  await dialog(page).getByLabel("Senha", { exact: true }).fill(USER.password);
  await dialog(page).getByLabel("Código de verificação").fill(saved.recovery[1]);
  await dialog(page).getByRole("button", { name: "Desativar" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText("Desativada")).toBeVisible();

  await signOut(page);
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
});
