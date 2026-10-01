import { expect, test, type Page } from "@playwright/test";

import { apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 04. Cria contas proprias pela API e registra os lancamentos pela tela,
// conferindo o saldo na tela de Contas depois de cada passo. Em ordem: cada passo parte do saldo do anterior.
test.describe.configure({ mode: "serial" });

const WALLET = "Carteira Form E2E";
const SAVINGS = "Poupanca Form E2E";
const DOLLAR = "Dolar Form E2E";
const DEBT = "Divida Form E2E";

const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const input = (page: Page, label: string) => dialog(page).getByLabel(label, { exact: true });
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });

async function goTo(page: Page, link: "Transações" | "Contas") {
  await nav(page).getByRole("link", { name: link }).click();
  await expect(page.getByRole("heading", { level: 1, name: link })).toBeVisible();
}

async function openNewTransaction(page: Page) {
  await page.getByRole("button", { name: "Novo lançamento" }).click();
  await expect(dialog(page)).toBeVisible();
}

async function expectBalance(page: Page, account: string, text: string) {
  await goTo(page, "Contas");
  const card = main(page).getByRole("heading", { level: 3, name: account }).locator("xpath=ancestor::li[1]");
  await expect(card).toContainText(text);
  await goTo(page, "Transações");
}

test("prepara quatro contas pela API", async ({ request }) => {
  const headers = await apiHeaders(request);
  const account = (name: string, extra: object) =>
    apiPost(request, headers, "/accounts", { name, currency_code: "BRL", ...extra });
  await account(WALLET, { type: "asset", opening_balance: "1000.00", opening_balance_date: "2026-01-01" });
  await account(SAVINGS, { type: "asset", role: "savings" });
  await account(DOLLAR, { type: "asset", currency_code: "USD" });
  await account(DEBT, { type: "liability", role: "loan", opening_balance: "500.00", opening_balance_date: "2026-01-01" });
});

test("formulario vazio mostra os erros e nao grava", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openNewTransaction(page);
  await dialog(page).getByRole("button", { name: "Criar lançamento" }).click();

  await expect(dialog(page).getByText("Informe a descrição.")).toBeVisible();
  await expect(dialog(page).getByText("Informe para quem foi.")).toBeVisible();
  await expect(dialog(page).getByText("Informe o valor.")).toBeVisible();
  await expect(dialog(page)).toBeVisible();
});

test("registra uma saida e o saldo da conta diminui", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openNewTransaction(page);

  await input(page, "Conta").selectOption({ label: WALLET });
  await input(page, "Descrição").fill("Mercado do bairro F5");
  await input(page, "Para quem").fill("Mercado do Ze");
  await input(page, "Valor (BRL)").fill("250,00");
  await dialog(page).getByRole("button", { name: "Criar lançamento" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByText("Mercado do bairro F5", { exact: true })).toBeVisible();
  await expectBalance(page, WALLET, "R$ 750,00");
});

test("registra uma entrada e o saldo aumenta", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openNewTransaction(page);

  await dialog(page).getByRole("radio", { name: "Entrada" }).check();
  await input(page, "Conta que recebe").selectOption({ label: WALLET });
  await input(page, "Descrição").fill("Freela F5");
  await input(page, "De quem").fill("Cliente Teste");
  await input(page, "Valor (BRL)").fill("100,00");
  await dialog(page).getByRole("button", { name: "Criar lançamento" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByText("Freela F5", { exact: true })).toBeVisible();
  await expectBalance(page, WALLET, "R$ 850,00");
});

test("lancamento dividido so salva quando as linhas fecham o total", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openNewTransaction(page);

  await input(page, "Conta").selectOption({ label: WALLET });
  await input(page, "Descrição").fill("Feira da semana F5");
  await input(page, "Para quem").fill("Feira livre");
  await input(page, "Valor (BRL)").fill("100,00");
  await dialog(page).getByRole("button", { name: "Dividir lançamento" }).click();

  await input(page, "Descrição da linha 1").fill("Frutas F5");
  await input(page, "Valor da linha 1").fill("60,00");
  await expect(dialog(page).getByRole("status").filter({ hasText: "Falta distribuir R$ 40,00" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Criar lançamento" }).click();
  await expect(dialog(page).getByRole("alert").filter({ hasText: "Falta distribuir R$ 40,00" })).toBeVisible();

  await dialog(page).getByRole("button", { name: "Adicionar linha" }).click();
  await input(page, "Descrição da linha 2").fill("Limpeza F5");
  await input(page, "Valor da linha 2").fill("40,00");
  await expect(dialog(page).getByRole("status").filter({ hasText: "Tudo distribuído." })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Criar lançamento" }).click();

  await expect(dialog(page)).toBeHidden();
  const group = main(page).getByText("Feira da semana F5", { exact: true }).locator("xpath=ancestor::li[1]");
  await expect(group).toContainText("Dividida em 2");
  await expect(group).toContainText("Frutas F5");
  await expect(group).toContainText("Limpeza F5");
  await expectBalance(page, WALLET, "R$ 750,00");
});

test("transferencia entre moedas credita o valor que chega na conta de destino", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openNewTransaction(page);

  await dialog(page).getByRole("radio", { name: "Transferência" }).check();
  await input(page, "Conta").selectOption({ label: WALLET });
  await input(page, "Descrição").fill("Envio ao dolar F5");
  await input(page, "Para a conta").selectOption({ label: `${DOLLAR} - USD` });
  await input(page, "Valor (BRL)").fill("100,00");
  await input(page, "Valor que chega em USD").fill("18,50");
  await expect(dialog(page).getByRole("button", { name: "Dividir lançamento" })).toBeHidden();
  await dialog(page).getByRole("button", { name: "Criar lançamento" }).click();

  await expect(dialog(page)).toBeHidden();
  await expectBalance(page, WALLET, "R$ 650,00");
  await expectBalance(page, DOLLAR, "US$ 18,50");
});

test("pagar uma divida reduz o valor devido", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openNewTransaction(page);

  await input(page, "Conta").selectOption({ label: WALLET });
  await input(page, "Descrição").fill("Parcela F5");
  await dialog(page).getByRole("button", { name: "Pagar uma dívida" }).click();
  await input(page, "Dívida").selectOption({ label: DEBT });
  await input(page, "Valor (BRL)").fill("200,00");
  await dialog(page).getByRole("button", { name: "Criar lançamento" }).click();

  await expect(dialog(page)).toBeHidden();
  await expectBalance(page, WALLET, "R$ 450,00");
  await expectBalance(page, DEBT, "R$ 300,00");
});

test("editar um lancamento muda o valor e o saldo acompanha", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");

  await page.getByRole("button", { name: "Ações do lançamento Mercado do bairro F5" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(input(page, "Descrição")).toHaveValue("Mercado do bairro F5");
  await expect(input(page, "Para quem")).toHaveValue("Mercado do Ze");
  await expect(input(page, "Valor (BRL)")).toHaveValue("250,00");

  await input(page, "Valor (BRL)").fill("300,00");
  await dialog(page).getByRole("button", { name: "Salvar" }).click();

  await expect(dialog(page)).toBeHidden();
  await expectBalance(page, WALLET, "R$ 400,00");
});

test("a conta Poupanca continua zerada: nada vazou para outra conta", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Contas");
  const card = main(page).getByRole("heading", { level: 3, name: SAVINGS }).locator("xpath=ancestor::li[1]");
  await expect(card).toContainText("R$ 0,00");
});
