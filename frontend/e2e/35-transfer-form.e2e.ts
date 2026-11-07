import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { apiHeaders, apiPost, loginAndWaitForDashboard, openTransferForm, pickChip } from "./helpers";

// Formulario proprio de transferencia (Nova transferencia). Cria contas proprias pela API e confere, depois de cada
// passo, o saldo na tela de Contas. Em ordem: cada passo parte do saldo do anterior.
test.describe.configure({ mode: "serial" });

const FROM = "Origem Transf E2E";
const TO = "Destino Transf E2E";
const DOLLAR = "Dolar Transf E2E";

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

test("prepara tres contas pela API", async ({ request }) => {
  const headers = await apiHeaders(request);
  const open = { opening_balance_date: "2026-01-01" };
  await apiPost(request, headers, "/accounts", { name: FROM, currency_code: "BRL", type: "asset", opening_balance: "1000.00", ...open });
  await apiPost(request, headers, "/accounts", { name: TO, currency_code: "BRL", type: "asset", opening_balance: "0.00", ...open });
  await apiPost(request, headers, "/accounts", { name: DOLLAR, currency_code: "USD", type: "asset", opening_balance: "0.00", ...open });
});

test("o formulario abre com os campos da transferencia e passa na varredura de acessibilidade", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openTransferForm(page);

  await expect(dialog(page).getByRole("button", { name: "Hoje" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog(page).getByRole("combobox", { name: "Conta de origem", exact: true })).toBeVisible();
  await expect(dialog(page).getByRole("combobox", { name: "Conta de destino", exact: true })).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Salvar", exact: true })).toBeDisabled();

  await dialog(page).getByRole("button", { name: /Mais detalhes/ }).click();
  await expect(dialog(page).getByRole("switch", { name: "Transferência fixa" })).toBeVisible();
  await expect(field(page, "Descrição")).toBeVisible();

  const result = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .disableRules(["meta-viewport"])
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("transferir entre duas contas em reais move o saldo dos dois lados", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openTransferForm(page);
  await pickChip(page, "Conta de origem", FROM);
  await pickChip(page, "Conta de destino", TO);
  await field(page, "Valor (BRL)").fill("250,00");
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page)).toContainText(`Transferência: ${FROM} → ${TO}`);

  await expectBalance(page, FROM, "R$ 750,00");
  await expectBalance(page, TO, "R$ 250,00");
});

test("a conta de destino nao oferece a propria origem", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openTransferForm(page);
  await pickChip(page, "Conta de origem", FROM);
  await dialog(page).getByRole("combobox", { name: "Conta de destino", exact: true }).click();
  await expect(page.getByRole("option", { name: FROM })).toHaveCount(0);
  await expect(page.getByRole("option", { name: TO })).toHaveCount(1);
});

test("entre moedas diferentes pede o valor que chega e o credita na conta de destino", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openTransferForm(page);
  await pickChip(page, "Conta de origem", FROM);
  await pickChip(page, "Conta de destino", DOLLAR);
  await field(page, "Valor (BRL)").fill("500,00");
  await dialog(page).getByLabel(/Valor que chega/).fill("100,00");
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();

  await expectBalance(page, FROM, "R$ 250,00");
  await expectBalance(page, DOLLAR, "US$ 100,00");
});

test("editar a descricao e o valor atualiza a transferencia e o saldo acompanha", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await page.getByRole("button", { name: `Ações do lançamento Transferência: ${FROM} → ${TO}` }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(page.getByRole("dialog", { name: "Editar transferência" })).toBeVisible();
  await expect(dialog(page).getByRole("combobox", { name: "Conta de origem", exact: true })).toContainText(FROM);
  await field(page, "Valor (BRL)").fill("100,00");
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();

  // 1000 - 100 (editada) - 500 (para o dolar) = 400; destino 0 + 100 = 100
  await expectBalance(page, FROM, "R$ 400,00");
  await expectBalance(page, TO, "R$ 100,00");
});

test("Salvar e criar nova guarda e deixa o formulario aberto", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await openTransferForm(page);
  await pickChip(page, "Conta de origem", FROM);
  await pickChip(page, "Conta de destino", TO);
  await field(page, "Valor (BRL)").fill("10,00");
  await dialog(page).getByRole("button", { name: "Salvar e criar nova" }).click();
  await expect(field(page, "Valor (BRL)")).toHaveValue("");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Fechar" }).click();
  await expectBalance(page, FROM, "R$ 390,00");
});
