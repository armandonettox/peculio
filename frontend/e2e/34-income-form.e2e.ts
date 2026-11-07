import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { apiHeaders, apiPost, loginAndWaitForDashboard, openIncomeForm } from "./helpers";

// Formulario proprio de receita (Nova receita), com "Foi recebida" e "Ignorar transacao". Cria uma conta propria pela API
// e confere, depois de cada passo, o saldo na tela de Contas. Em ordem: cada passo parte do saldo do anterior.
test.describe.configure({ mode: "serial" });

const WALLET = "Carteira Receita E2E";

const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const field = (page: Page, label: string) => dialog(page).getByLabel(label, { exact: true });
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });

async function goTo(page: Page, link: "Transações" | "Contas") {
  await nav(page).getByRole("link", { name: link, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: link })).toBeVisible();
}

async function expectBalance(page: Page, account: string, text: string) {
  await goTo(page, "Contas");
  const card = main(page).getByRole("heading", { level: 2, name: account }).locator("xpath=ancestor::li[1]");
  await expect(card).toContainText(text);
  await goTo(page, "Transações");
}

async function fillIncome(page: Page, description: string, amount: string) {
  await field(page, "Conta").selectOption({ label: WALLET });
  await field(page, "Descrição").fill(description);
  await field(page, "Valor (BRL)").fill(amount);
}

test("prepara a conta pela API", async ({ request }) => {
  const headers = await apiHeaders(request);
  await apiPost(request, headers, "/accounts", {
    name: WALLET,
    currency_code: "BRL",
    type: "asset",
    opening_balance: "1000.00",
    opening_balance_date: "2026-01-01",
  });
});

test("o formulario abre como receita e Mais detalhes passa na varredura de acessibilidade", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openIncomeForm(page);

  await expect(dialog(page).getByText("Foi recebida")).toBeVisible();
  await expect(dialog(page).getByRole("switch", { name: /Ignorar transação/ })).not.toBeChecked();

  await dialog(page).getByRole("button", { name: /Mais detalhes/ }).click();
  await expect(field(page, "De quem")).toBeVisible();
  await expect(dialog(page).getByRole("switch", { name: "Receita fixa" })).toBeVisible();
  await expect(dialog(page).getByLabel("Orçamento", { exact: true })).toHaveCount(0);

  const result = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .disableRules(["meta-viewport"])
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("receita recebida aumenta o saldo", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openIncomeForm(page);
  await fillIncome(page, "Salario Receita E2E", "200,00");
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page)).toContainText("Salario Receita E2E");
  await expectBalance(page, WALLET, "R$ 1.200,00");
});

test("receita nao recebida nao mexe no saldo e Efetivar passa a somar", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openIncomeForm(page);
  await fillIncome(page, "Freela Receita E2E", "50,00");
  await dialog(page).getByRole("switch", { name: /Foi recebida/ }).click();
  await expect(dialog(page).getByText("Não foi recebida")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();

  const row = main(page).getByRole("listitem").filter({ hasText: "Freela Receita E2E" });
  await expect(row.getByText("Não recebida")).toBeVisible();
  await expectBalance(page, WALLET, "R$ 1.200,00");

  await page.getByRole("button", { name: "Ações do lançamento Freela Receita E2E" }).click();
  await page.getByRole("menuitem", { name: "Efetivar" }).click();
  await expect(main(page).getByRole("listitem").filter({ hasText: "Freela Receita E2E" }).getByText("Não recebida")).toHaveCount(0);
  await expectBalance(page, WALLET, "R$ 1.250,00");
});

test("receita ignorada soma no saldo mas sai dos totais", async ({ page, request }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openIncomeForm(page);
  await fillIncome(page, "Reembolso Receita E2E", "30,00");
  await dialog(page).getByRole("switch", { name: /Ignorar transação/ }).click();
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();

  const row = main(page).getByRole("listitem").filter({ hasText: "Reembolso Receita E2E" });
  await expect(row.getByText("Ignorada")).toBeVisible();
  await expectBalance(page, WALLET, "R$ 1.280,00");

  // O total de receitas da conta so conta as duas que nao foram ignoradas (200 + 50)
  const headers = await apiHeaders(request);
  const accounts = await (await request.get("/api/v1/accounts", { headers })).json();
  const wallet = (accounts.items ?? accounts).find((account: { name: string }) => account.name === WALLET);
  const summary = await (
    await request.get("/api/v1/reports/summary", {
      headers,
      params: { date_from: "2000-01-01", date_to: "2100-01-01", account_id: wallet.id },
    })
  ).json();
  expect(summary.currencies[0].income).toBe("250.00");
});
