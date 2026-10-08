import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const FIXED = "Fixo Tpl E2E";
const GOAL = "Meta Tpl E2E";
const BILL = "Aluguel Tpl E2E";
const REST = "Sobra Tpl E2E";
const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });
const row = (page: Page, name: string) => main(page).getByRole("rowheader", { name: new RegExp(`^${name}`) }).locator("xpath=ancestor::tr[1]");
const field = (page: Page, name: string) => page.getByLabel(`Distribuído para ${name}`);
const today = () => new Date().toLocaleDateString("sv-SE");
const monthsAhead = (count: number) => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + count);
  return date.toLocaleDateString("sv-SE").slice(0, 7);
};

const saved = { billId: "" };

// Envelopes virou a aba Envelopes de Orcamentos
async function openEnvelopes(page: Page) {
  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Orçamentos" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Orçamentos e envelopes" })).toBeVisible();
  await page.getByRole("tab", { name: "Envelopes" }).click();
}

async function defineTemplate(page: Page, envelope: string, fill: () => Promise<void>) {
  await page.getByRole("button", { name: `Ações do envelope ${envelope}` }).click();
  await page.getByRole("menuitem", { name: /template/ }).click();
  await fill();
  await dialog(page).getByRole("button", { name: "Salvar" }).click();
  await expect(dialog(page)).toBeHidden();
}

async function currentToBudget(request: APIRequestContext): Promise<number> {
  const headers = await apiHeaders(request, ADMIN);
  const month = today().slice(0, 7);
  const response = await request.get("/api/v1/envelopes", { headers, params: { month } });
  const group = (await response.json()).groups.find((item: { currency_code: string }) => item.currency_code === "BRL");
  return Number(group.to_budget);
}

test("prepara dinheiro, envelopes e a conta a pagar pela API", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  // Bastante dinheiro: o "o que sobrar" precisa ter de onde tirar, qualquer que seja o estado dos outros arquivos
  await apiPost(request, headers, "/accounts", {
    name: "Conta Template E2E", type: "asset", role: "checking", currency_code: "BRL", opening_balance: "100000.00",
  });
  for (const name of [FIXED, GOAL, BILL, REST]) {
    await apiPost(request, headers, "/budgets", { name, currency_code: "BRL", mode: "envelope" });
  }
  const bill = await apiPost(request, headers, "/bills", {
    name: BILL, currency_code: "BRL", amount_min: "650.00", amount_max: "700.00",
    first_due_date: `${today().slice(0, 7)}-01`, frequency: "monthly",
  });
  saved.billId = bill.id;
});

test("define os quatro tipos de template pelo menu do envelope", async ({ page }) => {
  await openEnvelopes(page);
  await defineTemplate(page, FIXED, async () => {
    await dialog(page).getByLabel("Valor por mês (BRL)").fill("300,00");
  });
  await defineTemplate(page, GOAL, async () => {
    await dialog(page).getByRole("radio", { name: /Juntar até uma data/ }).check();
    await dialog(page).getByLabel("Meta (BRL)").fill("1200,00");
    await dialog(page).getByLabel("Meta pronta até o mês").fill(monthsAhead(3));
  });
  await defineTemplate(page, BILL, async () => {
    await dialog(page).getByRole("radio", { name: /Ligado a uma conta/ }).check();
    await dialog(page).getByLabel("Conta a pagar", { exact: true }).selectOption(saved.billId);
  });
  await defineTemplate(page, REST, async () => {
    await dialog(page).getByRole("radio", { name: /O que sobrar/ }).check();
  });

  await expect(row(page, FIXED)).toContainText(/R\$\s*300,00 por mês/);
  await expect(row(page, GOAL)).toContainText(/R\$\s*1\.200,00 até/);
  await expect(row(page, BILL)).toContainText(`Conta: ${BILL}`);
  await expect(row(page, REST)).toContainText("O que sobrar");
  // Definir o template nao distribui nada
  await expect(field(page, FIXED)).toHaveValue("0,00");
});

test("a previa mostra o que cada template faria e nao grava nada", async ({ page, request }) => {
  const before = await currentToBudget(request);
  await openEnvelopes(page);
  await page.getByRole("button", { name: "Aplicar templates" }).click();
  const table = dialog(page).getByRole("table", { name: "Prévia em BRL" });
  await expect(table).toBeVisible();
  const fixed = table.getByRole("rowheader", { name: new RegExp(FIXED) }).locator("xpath=ancestor::tr[1]");
  await expect(fixed).toContainText("Vai mudar");
  await expect(fixed).toContainText(/R\$\s*300,00/);
  await expect(table.getByRole("rowheader", { name: new RegExp(GOAL) }).locator("xpath=ancestor::tr[1]")).toContainText(/R\$\s*300,00/);
  await expect(table.getByRole("rowheader", { name: new RegExp(BILL) }).locator("xpath=ancestor::tr[1]")).toContainText(/R\$\s*700,00/);
  await expect(dialog(page).getByText("4 envelopes vão mudar.")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(field(page, FIXED)).toHaveValue("0,00");
  expect(await currentToBudget(request)).toBe(before);
});

test("aplicar preenche os envelopes e o que sobrar fica com o resto do A orcar", async ({ page, request }) => {
  await openEnvelopes(page);
  await page.getByRole("button", { name: "Aplicar templates" }).click();
  await dialog(page).getByRole("button", { name: "Aplicar" }).click();
  await expect(dialog(page)).toBeHidden();

  await expect(field(page, FIXED)).toHaveValue("300,00");
  await expect(field(page, GOAL)).toHaveValue("300,00");
  await expect(field(page, BILL)).toHaveValue("700,00");
  await expect(row(page, FIXED)).toContainText("Meta batida");
  // O resto do A orcar foi todo para o envelope "o que sobrar" (menos, no maximo, os centavos do arredondamento)
  const left = await currentToBudget(request);
  expect(left).toBeGreaterThanOrEqual(0);
  expect(left).toBeLessThan(0.02);
  expect(await field(page, REST).inputValue()).not.toBe("0,00");
});

test("aplicar de novo nao muda nada: todos ja tem valor", async ({ page }) => {
  await openEnvelopes(page);
  await page.getByRole("button", { name: "Aplicar templates" }).click();
  await expect(dialog(page).getByRole("table", { name: "Prévia em BRL" })).toBeVisible();
  await expect(dialog(page).getByText("Nenhum envelope vai mudar.")).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Nada para aplicar" })).toBeDisabled();
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
});

test("sobrescrever troca o valor que a pessoa tinha posto a mao", async ({ page }) => {
  await openEnvelopes(page);
  await field(page, FIXED).fill("50,00");
  await field(page, FIXED).press("Tab");
  await expect(field(page, FIXED)).toHaveValue("50,00");
  await expect(row(page, FIXED)).toContainText("Longe da meta");

  await page.getByRole("button", { name: "Aplicar templates" }).click();
  const table = dialog(page).getByRole("table", { name: "Prévia em BRL" });
  await expect(table.getByRole("rowheader", { name: new RegExp(FIXED) }).locator("xpath=ancestor::tr[1]")).toContainText("Já tem valor");
  await dialog(page).getByLabel("Sobrescrever os envelopes que já têm valor").check();
  await expect(table.getByRole("rowheader", { name: new RegExp(FIXED) }).locator("xpath=ancestor::tr[1]")).toContainText("Vai mudar");
  await dialog(page).getByRole("button", { name: "Aplicar" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(field(page, FIXED)).toHaveValue("300,00");
});

test("o mes seguinte pede de novo e a conta a pagar continua vencendo", async ({ page }) => {
  await openEnvelopes(page);
  await page.getByRole("button", { name: "Próximo mês" }).click();
  await page.getByRole("button", { name: "Aplicar templates" }).click();
  const table = dialog(page).getByRole("table", { name: "Prévia em BRL" });
  await expect(table.getByRole("rowheader", { name: new RegExp(BILL) }).locator("xpath=ancestor::tr[1]")).toContainText(/R\$\s*700,00/);
  // A meta de 1200 em 4 meses: o que passou de 300 reduz o que falta
  await expect(table.getByRole("rowheader", { name: new RegExp(GOAL) }).locator("xpath=ancestor::tr[1]")).toContainText(/R\$\s*300,00/);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
});

test("tirar o template some o resumo e o selo", async ({ page }) => {
  await openEnvelopes(page);
  await page.getByRole("button", { name: `Ações do envelope ${FIXED}` }).click();
  await page.getByRole("menuitem", { name: "Mudar template" }).click();
  await dialog(page).getByRole("button", { name: "Tirar template" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(row(page, FIXED)).not.toContainText("por mês");
  await expect(row(page, FIXED)).not.toContainText("Meta batida");
});

test("os dialogos e a tabela nao fazem a pagina rolar para o lado no celular", async ({ page }) => {
  await openEnvelopes(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(row(page, GOAL)).toBeVisible();
  let widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.window);
  await page.getByRole("button", { name: "Aplicar templates" }).click();
  await expect(dialog(page).getByRole("table", { name: "Prévia em BRL" })).toBeVisible();
  widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.window);
});
