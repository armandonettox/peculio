import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { apiHeaders, apiPost, loginAndWaitForDashboard, openExpenseForm } from "./helpers";

// Formulario proprio de despesa (Nova despesa), com "Foi paga" e "Ignorar transacao". Cria uma conta propria pela API e
// confere, depois de cada passo, o saldo na tela de Contas. Em ordem: cada passo parte do saldo do anterior.
test.describe.configure({ mode: "serial" });

const WALLET = "Carteira Despesa E2E";

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

async function fillExpense(page: Page, description: string, amount: string) {
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

test("o formulario abre com os campos do Mobills e os extras ficam em Mais detalhes", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openExpenseForm(page);

  await expect(dialog(page).getByText("Foi paga")).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Hoje" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog(page).getByRole("button", { name: "Ontem" })).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Outros..." })).toBeVisible();
  await expect(dialog(page).getByRole("switch", { name: /Ignorar transação/ })).not.toBeChecked();
  await expect(dialog(page).getByLabel("Notas", { exact: true })).toHaveCount(0);

  await dialog(page).getByRole("button", { name: /Mais detalhes/ }).click();
  await expect(field(page, "Para quem")).toBeVisible();
  await expect(field(page, "Notas")).toBeVisible();
  await expect(dialog(page).getByRole("switch", { name: "Despesa fixa" })).toBeVisible();
  await expect(dialog(page).getByRole("switch", { name: "Repetir" })).toBeVisible();

  // Com a segunda coluna aberta tambem passa na varredura de acessibilidade
  const result = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .disableRules(["meta-viewport"])
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("despesa paga diminui o saldo", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openExpenseForm(page);
  await fillExpense(page, "Padaria Despesa E2E", "100,00");
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page)).toContainText("Padaria Despesa E2E");
  await expectBalance(page, WALLET, "R$ 900,00");
});

test("despesa nao paga nao mexe no saldo e Efetivar passa a descontar", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openExpenseForm(page);
  await fillExpense(page, "Luz Despesa E2E", "50,00");
  await dialog(page).getByRole("switch", { name: /Foi paga/ }).click();
  await expect(dialog(page).getByText("Não foi paga")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();

  const row = main(page).getByRole("listitem").filter({ hasText: "Luz Despesa E2E" });
  await expect(row.getByText("Não paga")).toBeVisible();
  await expectBalance(page, WALLET, "R$ 900,00");

  await page.getByRole("button", { name: "Ações do lançamento Luz Despesa E2E" }).click();
  await page.getByRole("menuitem", { name: "Efetivar" }).click();
  await expect(main(page).getByRole("listitem").filter({ hasText: "Luz Despesa E2E" }).getByText("Não paga")).toHaveCount(0);
  await expectBalance(page, WALLET, "R$ 850,00");
});

test("despesa ignorada mexe no saldo mas sai dos totais", async ({ page, request }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openExpenseForm(page);
  await fillExpense(page, "Taxa Despesa E2E", "20,00");
  await dialog(page).getByRole("button", { name: "O que significa ignorar" }).click();
  await expect(dialog(page).getByText(/não será exibida nem considerada/)).toBeVisible();
  await dialog(page).getByRole("switch", { name: /Ignorar transação/ }).click();
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();

  const row = main(page).getByRole("listitem").filter({ hasText: "Taxa Despesa E2E" });
  await expect(row.getByText("Ignorada")).toBeVisible();
  await expectBalance(page, WALLET, "R$ 830,00");

  // O total de despesas da conta so conta as duas que nao foram ignoradas (100 + 50)
  const headers = await apiHeaders(request);
  const accounts = await (await request.get("/api/v1/accounts", { headers })).json();
  const wallet = (accounts.items ?? accounts).find((account: { name: string }) => account.name === WALLET);
  const summary = await (
    await request.get("/api/v1/reports/summary", {
      headers,
      params: { date_from: "2000-01-01", date_to: "2100-01-01", account_id: wallet.id },
    })
  ).json();
  expect(summary.currencies[0].expense).toBe("150.00");
});

test("Salvar e criar nova guarda e deixa o formulario aberto e limpo", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openExpenseForm(page);
  await fillExpense(page, "Cafe Despesa E2E", "8,00");
  await dialog(page).getByRole("button", { name: "Salvar e criar nova" }).click();
  await expect(field(page, "Descrição")).toHaveValue("");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Fechar" }).click();
  await expect(main(page)).toContainText("Cafe Despesa E2E");
});
