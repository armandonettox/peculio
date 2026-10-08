import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const ACCOUNT = "Conta Conciliar E2E";
const STATEMENT_DATE = "2026-03-31";
const main = (page: Page) => page.getByRole("main");
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });
const summary = (page: Page) => page.getByRole("region", { name: "Resumo" });
const history = (page: Page) => page.getByRole("region", { name: "Histórico" });
const mark = (page: Page, description: string) => page.getByRole("checkbox", { name: `Conferido: ${description}` });
// O Intl separa o simbolo do numero com espaco sem quebra
const money = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s/g, "\\s"));

let accountId = "";
let mercadoId = "";

async function api(request: APIRequestContext) {
  return apiHeaders(request);
}

async function transaction(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/v1/transactions/${id}`, { headers: await api(request) });
  expect(response.status()).toBe(200);
  return response.json();
}

// Conciliar virou a aba Conciliar de Importar e conciliar
async function openReconciliation(page: Page) {
  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Importar extrato" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Importar e conciliar" })).toBeVisible();
  await page.getByRole("tab", { name: "Conciliar" }).click();
}

async function check(page: Page, balance: string) {
  await page.getByLabel("Conta", { exact: true }).selectOption({ label: ACCOUNT });
  await page.getByLabel(/Saldo do extrato \(BRL\)/).fill(balance);
  await page.getByLabel("Data do extrato").fill(STATEMENT_DATE);
  await page.getByRole("button", { name: "Conferir" }).click();
}

test("prepara a conta e os lancamentos pela API", async ({ request }) => {
  const headers = await api(request);
  const account = await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    currency_code: "BRL",
    opening_balance: "1000.00",
    opening_balance_date: "2026-01-01",
  });
  accountId = account.id;
  const split = (type: string, description: string, amount: string, date: string) => ({
    splits: [{ type, date, description, amount, currency_code: "BRL", account_id: accountId, counterparty_name: "Loja" }],
  });
  const mercado = await apiPost(request, headers, "/transactions", split("withdrawal", "Mercado Conciliar E2E", "100.00", "2026-03-10"));
  mercadoId = mercado.id;
  await apiPost(request, headers, "/transactions", split("deposit", "Salario Conciliar E2E", "250.00", "2026-03-12"));
});

test("a tela aparece no menu e pede o saldo antes de conferir", async ({ page }) => {
  await openReconciliation(page);
  await page.getByRole("button", { name: "Conferir" }).click();
  await expect(main(page).getByText("Informe o valor.")).toBeVisible();
});

test("conferir os lancamentos zera a diferenca", async ({ page }) => {
  await openReconciliation(page);
  await check(page, "1150");
  await expect(main(page).getByText(/O extrato tem R\$.150,00 a mais do que o conferido\./)).toBeVisible();

  await mark(page, "Mercado Conciliar E2E").click();
  await expect(mark(page, "Mercado Conciliar E2E")).toBeChecked();
  await expect(main(page).getByText(/O extrato tem R\$.250,00 a mais do que o conferido\./)).toBeVisible();
  await mark(page, "Salario Conciliar E2E").click();
  await expect(mark(page, "Salario Conciliar E2E")).toBeChecked();
  await expect(main(page).getByText("O conferido bate com o extrato.")).toBeVisible();
  await expect(summary(page)).toContainText(money("R$ 1.150,00"));
  await expect(page.getByRole("button", { name: "Fechar conciliação" })).toBeEnabled();
});

test("uma diferenca pede confirmacao e o ajuste ja entra conferido", async ({ page, request }) => {
  await openReconciliation(page);
  await check(page, "1140");
  // As marcas da etapa anterior continuam no servidor
  await expect(main(page).getByText(/O conferido tem R\$.10,00 a mais do que o extrato\./)).toBeVisible();

  await page.getByRole("button", { name: "Criar lançamento de ajuste" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("uma saída de");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(main(page).getByText(/O conferido tem R\$.10,00 a mais do que o extrato\./)).toBeVisible();

  await page.getByRole("button", { name: "Criar lançamento de ajuste" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Criar ajuste" }).click();
  await expect(main(page).getByText("O conferido bate com o extrato.")).toBeVisible();
  await expect(mark(page, "Ajuste de conciliacao")).toBeChecked();

  const headers = await api(request);
  const list = await request.get(`/api/v1/transactions?account_id=${accountId}`, { headers });
  const titles = (await list.json()).items.map((item: { splits: { description: string }[] }) => item.splits[0].description);
  expect(titles.filter((title: string) => title === "Ajuste de conciliacao")).toHaveLength(1);
});

test("fechar trava os lancamentos e aparece no historico", async ({ page, request }) => {
  await openReconciliation(page);
  await check(page, "1140");
  await page.getByRole("button", { name: "Fechar conciliação" }).click();
  await expect(main(page).getByText("Conciliação fechada. 3 lançamentos travados.")).toBeVisible();
  await expect(mark(page, "Mercado Conciliar E2E")).toHaveCount(0);
  await expect(history(page)).toContainText("Fechada");
  await expect(history(page)).toContainText("3 lançamentos travados");

  const shown = await transaction(request, mercadoId);
  expect(shown.splits[0].cleared).toBe(true);
  expect(shown.splits[0].locked).toBe(true);
});

test("lancamento travado nao se edita nem se exclui", async ({ request }) => {
  const headers = await api(request);
  const shown = await transaction(request, mercadoId);
  const split = shown.splits[0];
  const body = {
    splits: [
      {
        type: "withdrawal",
        date: split.date,
        description: "Mercado editado",
        amount: split.amount,
        currency_code: "BRL",
        account_id: accountId,
        counterparty_name: "Loja",
      },
    ],
  };
  const edit = await request.put(`/api/v1/transactions/${mercadoId}`, { headers, data: body });
  expect(edit.status()).toBe(409);
  expect((await edit.json()).code).toBe("transaction_locked");
  expect((await request.delete(`/api/v1/transactions/${mercadoId}`, { headers })).status()).toBe(409);
});

test("desfazer a conciliacao destrava e mantem o historico", async ({ page, request }) => {
  await openReconciliation(page);
  await check(page, "1140");
  await history(page).getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("dialog")).toContainText("continuam marcados como conferidos");
  await page.getByRole("dialog").getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(history(page)).toContainText("Desfeita");
  await expect(history(page).getByRole("button", { name: "Desfazer" })).toHaveCount(0);
  await expect(mark(page, "Mercado Conciliar E2E")).toBeChecked();

  const shown = await transaction(request, mercadoId);
  expect(shown.splits[0].cleared).toBe(true);
  expect(shown.splits[0].locked).toBe(false);
});
