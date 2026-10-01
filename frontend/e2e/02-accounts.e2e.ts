import { expect, test, type Page } from "@playwright/test";

import { ADMIN, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01-auth, que cria o administrador. Os testes seguem em ordem e reaproveitam
// as contas criadas nos anteriores.
test.describe.configure({ mode: "serial" });

async function openAccounts(page: Page) {
  await loginAndWaitForDashboard(page);
  // Pelo menu, sem recarregar: recarregar apagaria o login (o token fica so em memoria)
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Contas" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contas" })).toBeVisible();
}

const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });
const card = (page: Page, name: string) =>
  page.getByRole("heading", { level: 3, name, exact: true }).locator("xpath=ancestor::li");

async function createAccount(
  page: Page,
  { name, opening, kind = "Conta", currency }: { name: string; opening?: string; kind?: "Conta" | "Dívida"; currency?: string },
) {
  await page.getByRole("button", { name: "Nova conta" }).first().click();
  const form = dialog(page, "Nova conta");
  if (kind === "Dívida") await form.getByRole("radio", { name: "Dívida" }).check();
  if (currency) await form.getByLabel("Moeda").selectOption(currency);
  await form.getByLabel("Nome", { exact: true }).fill(name);
  if (opening) await form.getByLabel(/Saldo inicial|Quanto você deve/).fill(opening);
  await form.getByRole("button", { name: "Criar conta" }).click();
}

test("o menu leva para Contas e a lista comeca vazia", async ({ page }) => {
  await openAccounts(page);
  await expect(page).toHaveURL("/contas");
  await expect(page.getByText("Nenhuma conta ativa")).toBeVisible();
});

test("o painel oferece um atalho para cadastrar a primeira conta", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.getByRole("link", { name: "Cadastrar conta" }).click();
  await expect(page).toHaveURL("/contas");
});

test("cria uma conta com saldo inicial e mostra o valor em reais", async ({ page }) => {
  await openAccounts(page);
  await createAccount(page, { name: "Nubank", opening: "3.200,50" });

  await expect(dialog(page, "Nova conta")).toBeHidden();
  await expect(card(page, "Nubank")).toContainText("R$ 3.200,50");
  await expect(card(page, "Nubank")).toContainText("Conta corrente");
  await expect(page.getByRole("region", { name: "Contas" })).toContainText("R$ 3.200,50");
});

test("o saldo guardado vem do banco: continua la depois de entrar de novo", async ({ page }) => {
  await openAccounts(page);
  await expect(card(page, "Nubank")).toContainText("R$ 3.200,50");
});

test("a API devolve o dinheiro como texto e isola por usuario", async ({ request }) => {
  const login = await request.post("/api/v1/auth/login", { data: { email: ADMIN.email, password: ADMIN.password } });
  const { access_token: token } = await login.json();
  const list = await request.get("/api/v1/accounts", { headers: { Authorization: `Bearer ${token}` } });
  const { items } = await list.json();
  expect(items[0].balance).toBe("3200.50");
  expect(typeof items[0].balance).toBe("string");
  expect((await request.get("/api/v1/accounts")).status()).toBe(401);
});

test("cria uma divida e mostra o valor devido, o total e o patrimonio liquido", async ({ page }) => {
  await openAccounts(page);
  await createAccount(page, { name: "Financiamento", kind: "Dívida", opening: "5.000" });

  await expect(card(page, "Financiamento")).toContainText("R$ 5.000,00");
  await expect(card(page, "Financiamento")).toContainText("Valor devido");
  await expect(page.getByRole("region", { name: "Dívidas" })).toContainText("Total devido: R$ 5.000,00");
  // 3.200,50 de conta menos 5.000,00 de divida
  await expect(page.getByText("Patrimônio líquido:")).toContainText("-R$ 1.799,50");
});

test("cria uma conta em outra moeda sem misturar nos totais", async ({ page }) => {
  await openAccounts(page);
  await createAccount(page, { name: "Wise", opening: "100", currency: "USD" });

  await expect(card(page, "Wise")).toContainText("US$ 100,00");
  await expect(page.getByRole("region", { name: "Contas" })).toContainText("R$ 3.200,50 · US$ 100,00");
});

test("nome repetido mostra o erro no campo e nao cria a conta", async ({ page }) => {
  await openAccounts(page);
  await createAccount(page, { name: "nubank" });

  await expect(dialog(page, "Nova conta").getByText("Já existe uma conta com esse nome.")).toBeVisible();
  await expect(dialog(page, "Nova conta").getByLabel("Nome", { exact: true })).toBeFocused();
  await dialog(page, "Nova conta").getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("heading", { level: 3, name: /^nubank$/i })).toHaveCount(1);
});

test("valor invalido e recusado no formulario, sem chamar o servidor", async ({ page }) => {
  await openAccounts(page);
  await page.getByRole("button", { name: "Nova conta" }).first().click();
  const form = dialog(page, "Nova conta");
  await form.getByLabel("Nome", { exact: true }).fill("Teste");
  await form.getByLabel("Saldo inicial").fill("10,555");
  await form.getByRole("button", { name: "Criar conta" }).click();

  await expect(form.getByText("Use no máximo 2 casas decimais.")).toBeVisible();
  await expect(form).toBeVisible();
});

test("edita o nome e o saldo inicial", async ({ page }) => {
  await openAccounts(page);
  await card(page, "Nubank").getByRole("button", { name: "Ações da conta Nubank" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();

  const form = dialog(page, "Editar conta");
  await expect(form.getByLabel("Moeda")).toBeDisabled();
  await form.getByLabel("Nome", { exact: true }).fill("Nubank Roxinho");
  await form.getByLabel("Saldo inicial").fill("4.000,00");
  await form.getByRole("button", { name: "Salvar" }).click();

  await expect(card(page, "Nubank Roxinho")).toContainText("R$ 4.000,00");
  await expect(page.getByRole("heading", { level: 3, name: "Nubank", exact: true })).toHaveCount(0);
});

test("arquivar tira da lista e restaurar traz de volta", async ({ page }) => {
  await openAccounts(page);
  await card(page, "Wise").getByRole("button", { name: "Ações da conta Wise" }).click();
  await page.getByRole("menuitem", { name: "Arquivar" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Wise", exact: true })).toHaveCount(0);

  await page.getByLabel("Mostrar arquivadas").check();
  await expect(card(page, "Wise")).toContainText("Arquivada");

  await card(page, "Wise").getByRole("button", { name: "Ações da conta Wise" }).click();
  await page.getByRole("menuitem", { name: "Restaurar" }).click();
  await page.getByLabel("Mostrar arquivadas").uncheck();
  await expect(card(page, "Wise")).toBeVisible();
  await expect(card(page, "Wise")).not.toContainText("Arquivada");
});

test("excluir pede confirmacao e remove a conta", async ({ page }) => {
  await openAccounts(page);
  await card(page, "Wise").getByRole("button", { name: "Ações da conta Wise" }).click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();

  await dialog(page, "Excluir conta").getByRole("button", { name: "Cancelar" }).click();
  await expect(card(page, "Wise")).toBeVisible();

  await card(page, "Wise").getByRole("button", { name: "Ações da conta Wise" }).click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  await dialog(page, "Excluir conta").getByRole("button", { name: "Excluir" }).click();

  await expect(page.getByRole("heading", { level: 3, name: "Wise", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Contas" })).not.toContainText("US$");
});

test("no celular a lista fica em uma coluna e o formulario cabe na tela", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await loginAndWaitForDashboard(page);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Contas" }).click();

  await expect(card(page, "Nubank Roxinho")).toBeVisible();
  await page.getByRole("button", { name: "Nova conta" }).first().click();
  const form = dialog(page, "Nova conta");
  const box = await form.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await form.getByRole("button", { name: "Cancelar" }).click();
});
