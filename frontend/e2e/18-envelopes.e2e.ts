import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const ACCOUNT = "Conta Envelope E2E";
const MARKET = "Mercado Env E2E";
const FUN = "Lazer Env E2E";
const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });
const row = (page: Page, name: string) => main(page).getByRole("rowheader", { name }).locator("xpath=ancestor::tr[1]");
const field = (page: Page, name: string) => page.getByLabel(`Distribuído para ${name}`);
const today = () => new Date().toLocaleDateString("sv-SE");
const thisMonth = () => today().slice(0, 7);

// O que um passo descobre e os seguintes usam
const saved = { accountId: "", marketId: "", funId: "", beforeToBudget: 0, beforeMoney: 0 };

/** O grupo em reais do mes atual, direto da API: o "A orcar" depende de outras contas do E2E, entao so se compara a diferenca. */
async function brl(request: APIRequestContext) {
  const headers = await apiHeaders(request, ADMIN);
  const response = await request.get("/api/v1/envelopes", { headers, params: { month: thisMonth() } });
  expect(response.status()).toBe(200);
  const group = (await response.json()).groups.find((item: { currency_code: string }) => item.currency_code === "BRL");
  return { money: Number(group.money), toBudget: Number(group.to_budget) };
}

async function openEnvelopes(page: Page) {
  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Envelopes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Envelopes" })).toBeVisible();
}

async function createEnvelope(page: Page, name: string) {
  await page.getByRole("button", { name: "Novo envelope" }).first().click();
  await expect(dialog(page).getByRole("radio", { name: /Envelope/ })).toBeChecked();
  await expect(dialog(page).getByLabel("Limite por período")).toHaveCount(0);
  await dialog(page).getByLabel("Nome", { exact: true }).fill(name);
  await dialog(page).getByRole("button", { name: "Criar orçamento" }).click();
  await expect(dialog(page)).toBeHidden();
}

async function allocate(page: Page, name: string, value: string) {
  await field(page, name).fill(value);
  await field(page, name).press("Tab");
}

async function spend(request: APIRequestContext, amount: string) {
  const headers = await apiHeaders(request, ADMIN);
  await apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "withdrawal",
        date: today(),
        description: "Compra Envelope E2E",
        amount,
        currency_code: "BRL",
        account_id: saved.accountId,
        counterparty_name: "Loja Envelope E2E",
        budget_id: saved.marketId,
      },
    ],
  });
}

test("prepara a conta pela API", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const account = await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    role: "checking",
    currency_code: "BRL",
    opening_balance: "500.00",
  });
  saved.accountId = account.id;
});

test("sem envelopes a pagina convida a criar o primeiro", async ({ page }) => {
  await openEnvelopes(page);
  await expect(page.getByText("Nenhum envelope ainda")).toBeVisible();
});

test("cria dois envelopes pelo formulario, sem limite nem periodo", async ({ page, request }) => {
  await openEnvelopes(page);
  await createEnvelope(page, MARKET);
  await expect(row(page, MARKET)).toBeVisible();
  await page.getByRole("button", { name: "Novo envelope" }).first().click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(FUN);
  await dialog(page).getByRole("button", { name: "Criar orçamento" }).click();
  await expect(row(page, FUN)).toBeVisible();

  // Os dois comecam zerados e o botao de mover aparece com mais de um envelope
  await expect(row(page, MARKET)).toContainText("Zerado");
  await expect(page.getByRole("button", { name: "Mover dinheiro" })).toBeVisible();
  const headers = await apiHeaders(request, ADMIN);
  const budgets = await (await request.get("/api/v1/budgets", { headers })).json();
  const market = budgets.items.find((item: { name: string }) => item.name === MARKET);
  expect(market.mode).toBe("envelope");
  expect(market.amount).toBeNull();
  saved.marketId = market.id;
  saved.funId = budgets.items.find((item: { name: string }) => item.name === FUN).id;
});

test("distribuir move dinheiro do A orcar para o envelope", async ({ page, request }) => {
  const before = await brl(request);
  await openEnvelopes(page);
  await allocate(page, MARKET, "200,00");
  await expect(row(page, MARKET)).toContainText(/R\$\s*200,00/);
  await expect(field(page, MARKET)).toHaveValue("200,00");

  const after = await brl(request);
  expect(after.money).toBe(before.money);
  expect(before.toBudget - after.toBudget).toBe(200);
  // A tela mostra o mesmo A orcar que a API
  await expect(page.getByLabel("A orçar em BRL")).toContainText(String(after.toBudget).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, "."));
});

test("um valor invalido avisa no campo e nada muda", async ({ page, request }) => {
  const before = await brl(request);
  await openEnvelopes(page);
  await field(page, MARKET).fill("abc");
  await field(page, MARKET).press("Tab");
  await expect(row(page, MARKET).getByRole("alert")).toContainText("Valor inválido");
  expect((await brl(request)).toBudget).toBe(before.toBudget);
});

test("gastar do envelope baixa o disponivel mas nao o A orcar", async ({ page, request }) => {
  const before = await brl(request);
  await spend(request, "50.00");
  await openEnvelopes(page);
  await expect(row(page, MARKET)).toContainText(/R\$\s*50,00/);
  await expect(row(page, MARKET)).toContainText(/R\$\s*150,00/);
  const after = await brl(request);
  expect(before.money - after.money).toBe(50);
  expect(after.toBudget).toBe(before.toBudget);
});

test("estourar o envelope mostra o rotulo e oferece cobrir", async ({ page, request }) => {
  await spend(request, "300.00");
  await openEnvelopes(page);
  await expect(row(page, MARKET)).toContainText("Estourou");
  await expect(row(page, MARKET).getByRole("button", { name: /^Cobrir/ })).toContainText(/R\$\s*150,00/);
});

test("cobrir o estouro movendo dinheiro de outro envelope", async ({ page, request }) => {
  await openEnvelopes(page);
  await allocate(page, FUN, "300,00");
  const before = await brl(request);

  await row(page, MARKET).getByRole("button", { name: /^Cobrir/ }).click();
  await expect(dialog(page).getByLabel("Levar para")).toHaveValue(saved.marketId);
  await dialog(page).getByLabel("Tirar de").selectOption(saved.funId);
  await dialog(page).getByLabel("Valor (BRL)").fill("150,00");
  await dialog(page).getByRole("button", { name: "Mover" }).click();
  await expect(dialog(page)).toBeHidden();

  await expect(row(page, MARKET)).toContainText("Zerado");
  await expect(field(page, FUN)).toHaveValue("150,00");
  // O estouro de 150 tinha saido do A orcar; cobrir com o dinheiro de outro envelope devolve esse valor
  expect((await brl(request)).toBudget - before.toBudget).toBe(150);
});

test("o mes seguinte herda a sobra e o estouro volta a zero", async ({ page }) => {
  await openEnvelopes(page);
  await page.getByRole("button", { name: "Próximo mês" }).click();
  // Mercado fechou zerado; Lazer fechou com 150 e passa adiante
  await expect(row(page, FUN)).toContainText(/R\$\s*150,00/);
  await expect(row(page, MARKET)).not.toContainText("Estourou");
  await page.getByRole("button", { name: "Mês atual" }).click();
  await expect(row(page, MARKET)).toBeVisible();
});

test("desmarcar Entra nos envelopes tira o dinheiro da conta do A orcar", async ({ page, request }) => {
  const before = await brl(request);
  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Contas", exact: true }).click();
  await page.getByRole("button", { name: `Ações da conta ${ACCOUNT}` }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const box = dialog(page).getByLabel(/Entra nos envelopes/);
  await expect(box).toBeChecked();
  await box.uncheck();
  await dialog(page).getByRole("button", { name: "Salvar" }).click();
  await expect(dialog(page)).toBeHidden();

  const after = await brl(request);
  // A conta tinha 500 menos os gastos de 350 deste teste
  expect(before.money - after.money).toBe(150);
  expect(before.toBudget - after.toBudget).toBe(150);
});

test("a pagina de envelopes nao rola para o lado no celular", async ({ page }) => {
  await openEnvelopes(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(row(page, MARKET)).toBeVisible();
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.window);
});

test("excluir um envelope pede confirmacao e some da lista", async ({ page }) => {
  await openEnvelopes(page);
  await page.getByRole("button", { name: `Ações do envelope ${FUN}` }).click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  await expect(dialog(page).getByText(FUN)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(row(page, FUN)).toBeVisible();

  await page.getByRole("button", { name: `Ações do envelope ${FUN}` }).click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await expect(main(page).getByRole("rowheader", { name: FUN })).toHaveCount(0);
  await expect(row(page, MARKET)).toBeVisible();
});
