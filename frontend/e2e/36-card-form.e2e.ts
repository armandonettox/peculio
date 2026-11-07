import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { apiHeaders, apiPost, loginAndWaitForDashboard, openCardForm, pickChip } from "./helpers";

// Formulario proprio de despesa de cartao (Nova despesa de cartao), com a fatura escolhida na compra. Cria um cartao
// proprio pela API e confere os totais das faturas pela API da fatura. Em ordem: cada passo parte do anterior.
test.describe.configure({ mode: "serial" });

const CARD = "Cartao Fatura E2E";

const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const field = (page: Page, label: string) => dialog(page).getByLabel(label, { exact: true });
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });

async function goToTransactions(page: Page) {
  await nav(page).getByRole("link", { name: "Transações", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Transações" })).toBeVisible();
}

async function cardId(request: APIRequestContext) {
  const headers = await apiHeaders(request);
  const accounts = await (await request.get("/api/v1/accounts", { headers })).json();
  const found = (accounts.items ?? accounts).find((account: { name: string }) => account.name === CARD);
  return { headers, id: found.id as string };
}

type Option = { period_start: string; period_end: string; due_date: string; total: string; status: string };

async function options(request: APIRequestContext): Promise<Option[]> {
  const { headers, id } = await cardId(request);
  return (await request.get(`/api/v1/accounts/${id}/invoices`, { headers })).json();
}

async function invoiceTotal(request: APIRequestContext, on: string) {
  const { headers, id } = await cardId(request);
  const body = await (await request.get(`/api/v1/accounts/${id}/invoice`, { headers, params: { on } })).json();
  return body.total as string;
}

async function chooseInvoice(page: Page, status: string) {
  await dialog(page).getByRole("combobox", { name: "Fatura", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`\\(${status}\\)`) }).first().click();
}

async function fillPurchase(page: Page, description: string, amount: string) {
  await pickChip(page, "Cartão", CARD);
  await field(page, "Descrição").fill(description);
  await field(page, "Valor (BRL)").fill(amount);
}

test("prepara o cartao pela API", async ({ request }) => {
  const headers = await apiHeaders(request);
  await apiPost(request, headers, "/accounts", {
    name: CARD,
    currency_code: "BRL",
    type: "asset",
    role: "credit_card",
    opening_balance: "0",
    closing_day: 28,
    due_day: 5,
  });
});

test("o formulario abre com os campos do cartao e passa na varredura de acessibilidade", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goToTransactions(page);
  await openCardForm(page);

  await pickChip(page, "Cartão", CARD);
  await expect(dialog(page).getByText("Foi paga")).toHaveCount(0);
  await expect(dialog(page).getByRole("button", { name: "Anexar arquivo" })).toHaveCount(0);
  await expect(dialog(page).getByRole("switch", { name: /Ignorar transação/ })).toBeVisible();
  await expect(dialog(page).getByRole("combobox", { name: "Fatura", exact: true })).toContainText("Aberta");

  await dialog(page).getByRole("button", { name: /Mais detalhes/ }).click();
  await expect(dialog(page).getByRole("switch", { name: "Parcelado" })).toBeVisible();
  await expect(dialog(page).getByRole("switch", { name: "Repetir" })).toHaveCount(0);

  const result = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .disableRules(["meta-viewport"])
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("a lista de faturas mostra a aberta e as proximas, e a aberta ja vem escolhida", async ({ page, request }) => {
  const all = await options(request);
  expect(all.filter((item) => item.status === "open")).toHaveLength(1);
  expect(all.some((item) => item.status === "partial")).toBe(true);

  await loginAndWaitForDashboard(page);
  await goToTransactions(page);
  await openCardForm(page);
  await pickChip(page, "Cartão", CARD);
  await dialog(page).getByRole("combobox", { name: "Fatura", exact: true }).click();
  await expect(page.getByRole("option", { name: /\(Aberta\)/ })).toHaveCount(1);
  await expect(page.getByRole("option", { name: /\(Parcial\)/ }).first()).toBeVisible();
});

test("sem escolher fatura a compra entra na fatura da data", async ({ page, request }) => {
  await loginAndWaitForDashboard(page);
  await goToTransactions(page);
  await openCardForm(page);
  await fillPurchase(page, "Mercado Fatura E2E", "100,00");
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page)).toContainText("Mercado Fatura E2E");

  const open = (await options(request)).find((item) => item.status === "open")!;
  expect(open.total).toBe("100.00");
});

test("escolher a proxima fatura manda a compra para ela, e a aberta continua igual", async ({ page, request }) => {
  const before = await options(request);
  const next = before.find((item) => item.status === "partial")!;
  expect(next.total).toBe("0.00");

  await loginAndWaitForDashboard(page);
  await goToTransactions(page);
  await openCardForm(page);
  await fillPurchase(page, "Presente Fatura E2E", "50,00");
  await chooseInvoice(page, "Parcial");
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();

  const after = await options(request);
  expect(after.find((item) => item.period_end === next.period_end)!.total).toBe("50.00");
  expect(after.find((item) => item.status === "open")!.total).toBe("100.00");
  expect(await invoiceTotal(request, next.period_end)).toBe("50.00");
});

test("parcelar a partir da fatura escolhida cai uma parcela em cada fatura seguinte", async ({ page, request }) => {
  const before = await options(request);
  const partials = before.filter((item) => item.status === "partial");
  const first = partials[1]!;
  const baseTotals = partials.slice(1, 4).map((item) => item.total);

  await loginAndWaitForDashboard(page);
  await goToTransactions(page);
  await openCardForm(page);
  await fillPurchase(page, "Sofa Fatura E2E", "300,00");
  await dialog(page).getByRole("combobox", { name: "Fatura", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`Vence ${first.due_date.split("-").reverse().join("/")}`) }).click();
  await dialog(page).getByRole("button", { name: /Mais detalhes/ }).click();
  await dialog(page).getByRole("switch", { name: "Parcelado" }).click();
  await field(page, "vezes").fill("3");
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByText("Sofa Fatura E2E (1/3)")).toBeVisible();

  const after = await options(request);
  const index = after.findIndex((item) => item.period_end === first.period_end);
  const added = after.slice(index, index + 3).map((item, position) => Number(item.total) - Number(baseTotals[position]));
  expect(added).toEqual([100, 100, 100]);
});

test("editar a compra abre o formulario de cartao e mantem a fatura escolhida", async ({ page, request }) => {
  const next = (await options(request)).find((item) => item.total === "50.00")!;

  await loginAndWaitForDashboard(page);
  await goToTransactions(page);
  await page.getByRole("button", { name: "Ações do lançamento Presente Fatura E2E" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(page.getByRole("dialog", { name: "Editar despesa de cartão" })).toBeVisible();
  await expect(dialog(page).getByRole("combobox", { name: "Fatura", exact: true })).toContainText("Parcial");
  await field(page, "Valor (BRL)").fill("70,00");
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();

  expect(await invoiceTotal(request, next.period_end)).toBe("70.00");
});
