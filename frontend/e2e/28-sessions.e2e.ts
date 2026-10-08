import { expect, test, type Browser, type Page } from "@playwright/test";

import { ADMIN, field, login, loginAndWaitForDashboard, openSettings } from "./helpers";

// Manter conectado: cookie de renovacao HttpOnly, restaurar a sessao ao abrir, lista de aparelhos e sair de verdade.
// Em ordem: cada passo parte do anterior.
test.describe.configure({ mode: "serial" });

const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });
const dashboard = (page: Page) => page.getByRole("heading", { level: 1, name: "Painel" });

async function loginPage(page: Page, remember: boolean) {
  await page.goto("/login");
  if (remember) await page.getByRole("checkbox", { name: /Manter conectado/ }).check();
  await login(page, ADMIN);
  await expect(dashboard(page)).toBeVisible();
}

async function refreshCookie(page: Page) {
  return (await page.context().cookies()).find((cookie) => cookie.name === "peculio_refresh");
}

async function openSecurity(page: Page) {
  await openSettings(page, "Segurança");
  await expect(page.getByRole("heading", { level: 2, name: "Verificação em duas etapas" })).toBeVisible();
}

// Um navegador de verdade e novo: cookies proprios, como um segundo aparelho
async function secondDevice(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test("entrar sem marcar a caixa guarda um cookie que o JavaScript nao le e some ao fechar o navegador", async ({ page }) => {
  await loginPage(page, false);
  const cookie = await refreshCookie(page);
  expect(cookie).toBeDefined();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe("Strict");
  expect(cookie!.path).toBe("/api/v1/auth");
  // Cookie de sessao do navegador: sem data de validade
  expect(cookie!.expires).toBe(-1);
  // O JavaScript da pagina nao enxerga o cookie
  expect(await page.evaluate(() => document.cookie)).not.toContain("peculio_refresh");
});

test("recarregar a pagina (F5) continua logado, sem pedir senha", async ({ page }) => {
  await loginPage(page, false);
  const before = (await refreshCookie(page))!.value;
  await page.reload();
  await expect(dashboard(page)).toBeVisible();
  // A chave do cookie foi trocada na restauracao
  expect((await refreshCookie(page))!.value).not.toBe(before);
});

test("marcando Manter conectado o cookie dura 30 dias", async ({ page }) => {
  await loginPage(page, true);
  const cookie = (await refreshCookie(page))!;
  const days = (cookie.expires - Date.now() / 1000) / 86400;
  expect(days).toBeGreaterThan(29);
  expect(days).toBeLessThanOrEqual(30.01);
  await page.reload();
  await expect(dashboard(page)).toBeVisible();
});

test("a pagina Seguranca mostra este aparelho e o outro, e encerrar o outro derruba o acesso dele", async ({ page, browser }) => {
  await loginPage(page, false);

  // Os testes anteriores deixaram sessoes abertas nesta conta: comeca limpando tudo menos este aparelho
  await openSecurity(page);
  // So procura o botao depois que a lista carregou
  await expect(page.getByText("Este aparelho")).toBeVisible();
  const cleanup = page.getByRole("button", { name: /^Encerrar (o outro aparelho|os outros \d+ aparelhos)$/ });
  if (await cleanup.count()) {
    await cleanup.click();
    await expect(page.getByText(/encerrados?\./)).toBeVisible();
  }

  const other = await secondDevice(browser);
  await loginPage(other.page, true);
  // Volta ao painel e abre de novo, para a lista ser buscada com o outro aparelho ja conectado
  await nav(page).getByRole("link", { name: "Painel" }).click();
  await openSecurity(page);
  const rows = page.getByRole("listitem").filter({ hasText: /Entrou em/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Este aparelho" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Manter conectado" })).toHaveCount(1);

  await page.getByRole("button", { name: /^Encerrar .*usado/ }).click();
  await expect(page.getByText(/foi encerrado\./)).toBeVisible();
  await expect(rows).toHaveCount(1);

  // O outro aparelho caiu: o token e o cookie dele nao valem mais
  await other.page.reload();
  await expect(other.page.getByRole("button", { name: "Entrar" })).toBeVisible();
  await other.context.close();
});

test("Sair avisa o servidor: depois de recarregar continua deslogado", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  // O cookie foi apagado e a sessao encerrada no servidor
  expect(await refreshCookie(page)).toBeUndefined();
  await page.reload();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
});

test("trocar a senha encerra os outros aparelhos e mantem este", async ({ page, browser }) => {
  await loginPage(page, true);
  const other = await secondDevice(browser);
  await loginPage(other.page, true);

  await openSettings(page);
  await field(page, "Senha atual").fill(ADMIN.password);
  await field(page, "Nova senha").fill("SenhaNova987");
  await field(page, "Repita a nova senha").fill("SenhaNova987");
  await page.getByRole("button", { name: "Trocar senha" }).click();
  await expect(page.getByText(/Senha alterada/)).toBeVisible();

  // Este segue logado, inclusive depois de recarregar (continua em Configuracoes)
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
  // O outro nao consegue mais entrar pelo cookie
  await other.page.reload();
  await expect(other.page.getByRole("button", { name: "Entrar" })).toBeVisible();
  await other.context.close();

  // Devolve a senha original: os outros arquivos de teste entram com ela
  await field(page, "Senha atual").fill("SenhaNova987");
  await field(page, "Nova senha").fill(ADMIN.password);
  await field(page, "Repita a nova senha").fill(ADMIN.password);
  await page.getByRole("button", { name: "Trocar senha" }).click();
  await expect(page.getByText(/Senha alterada/)).toBeVisible();
});

test("o cabecalho do app e obrigatorio: um pedido de fora nao restaura a sessao", async ({ page, request }) => {
  await loginPage(page, true);
  const forged = await request.post("/api/v1/auth/session", {
    headers: { cookie: `peculio_refresh=${(await refreshCookie(page))!.value}` },
  });
  expect(forged.status()).toBe(403);
  expect((await forged.json()).code).toBe("client_header_missing");
});
