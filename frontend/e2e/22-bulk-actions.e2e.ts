import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const ACCOUNT = "Conta Massa E2E";
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });
const bar = (page: Page) => page.getByRole("region", { name: "Ações em massa" });
const rowOf = (page: Page, text: string) => page.getByRole("row", { name: new RegExp(`^${text}`) });
const check = (page: Page, title: string) => page.getByRole("checkbox", { name: `Selecionar ${title} Massa E2E` });

let accountId = "";
let categoryId = "";
const ids: Record<string, string> = {};

async function balance(request: APIRequestContext): Promise<string> {
  const response = await request.get(`/api/v1/accounts/${accountId}`, { headers: await apiHeaders(request) });
  expect(response.status()).toBe(200);
  return (await response.json()).balance;
}

async function split(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/v1/transactions/${id}`, { headers: await apiHeaders(request) });
  expect(response.status()).toBe(200);
  return (await response.json()).splits[0];
}

// Abre a pagina pelo menu (o token fica so em memoria) e mostra so os lancamentos deste teste, em tabela
async function openTable(page: Page) {
  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Transações" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Transações" })).toBeVisible();
  await page.getByLabel("Buscar lançamentos").fill("Massa E2E");
  // O filtro entra com um pequeno atraso e a lista recarrega: espera isso acabar antes de agir
  await expect(page.getByText(/com os filtros escolhidos/)).toBeVisible();
  await page.getByRole("button", { name: "Tabela", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
}

test("prepara a conta, a categoria e quatro lancamentos pela API", async ({ request }) => {
  const headers = await apiHeaders(request);
  const account = await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    currency_code: "BRL",
    opening_balance: "1000.00",
    opening_balance_date: "2026-01-01",
  });
  accountId = account.id;
  categoryId = (await apiPost(request, headers, "/categories", { name: "Mercado Massa E2E" })).id;
  for (const [index, name] of ["Item1", "Item2", "Item3", "Item4"].entries()) {
    const created = await apiPost(request, headers, "/transactions", {
      splits: [
        {
          type: "withdrawal",
          date: `2026-03-1${index}`,
          description: `${name} Massa E2E`,
          amount: `${(index + 1) * 10}.00`,
          currency_code: "BRL",
          account_id: accountId,
          counterparty_name: "Loja",
        },
      ],
    });
    ids[name] = created.id;
  }
  expect(await balance(request)).toBe("900.00");
});

test("o teclado marca, marca intervalo, marca todos e limpa", async ({ page }) => {
  await openTable(page);
  // Mais recente primeiro: Item4, Item3, Item2, Item1
  await rowOf(page, "Item4 Massa E2E").focus();
  await page.keyboard.press("Space");
  await expect(bar(page).getByRole("status")).toHaveText("1 selecionado");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+Space");
  await expect(bar(page).getByRole("status")).toHaveText("3 selecionados");
  await expect(check(page, "Item1")).not.toBeChecked();

  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await expect(bar(page).getByRole("status")).toHaveText("4 selecionados");
  await page.keyboard.press("Control+a");
  await expect(bar(page)).toHaveCount(0);
});

test("mudar a categoria de dois lancamentos deixa os outros como estavam", async ({ page, request }) => {
  await openTable(page);
  await check(page, "Item1").check();
  await check(page, "Item2").check();
  await bar(page).getByRole("button", { name: "Mudar categoria" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Categoria").selectOption({ label: "Mercado Massa E2E" });
  await dialog.getByRole("button", { name: "Mudar categoria" }).click();

  await expect(page.getByText("Categoria mudada em 2 lançamentos.")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await expect(rowOf(page, "Item1 Massa E2E")).toContainText("Mercado Massa E2E");
  expect((await split(request, ids.Item1)).category_id).toBe(categoryId);
  expect((await split(request, ids.Item2)).category_id).toBe(categoryId);
  expect((await split(request, ids.Item3)).category_id).toBeNull();
});

test("mudar a data de um lancamento", async ({ page, request }) => {
  await openTable(page);
  await check(page, "Item3").check();
  await bar(page).getByRole("button", { name: "Mudar data" }).click();
  await page.getByRole("dialog").getByLabel("Data").fill("2026-02-01");
  await page.getByRole("dialog").getByRole("button", { name: "Mudar data" }).click();
  await expect(page.getByText("Data mudada em 1 lançamento.")).toBeVisible();
  expect((await split(request, ids.Item3)).date).toBe("2026-02-01");
  expect((await split(request, ids.Item4)).date).toBe("2026-03-13");
});

test("duplicar cria uma copia com a data de hoje e mexe no saldo", async ({ page, request }) => {
  await openTable(page);
  await check(page, "Item1").check();
  await bar(page).getByRole("button", { name: "Duplicar" }).click();
  await expect(page.getByText("1 lançamento duplicado com a data de hoje.")).toBeVisible();
  await expect(page.getByRole("row", { name: /^Item1 Massa E2E/ })).toHaveCount(2);
  expect(await balance(request)).toBe("890.00");

  const list = await request.get("/api/v1/transactions?q=Item1%20Massa%20E2E", { headers: await apiHeaders(request) });
  const copies = (await list.json()).items.filter((item: { id: string }) => item.id !== ids.Item1);
  expect(copies).toHaveLength(1);
  expect(copies[0].splits[0].category_id).toBe(categoryId);
  expect(copies[0].splits[0].date).not.toBe("2026-03-10");
});

test("um lancamento travado barra a acao inteira e pode ser desmarcado", async ({ page, request }) => {
  const headers = await apiHeaders(request);
  const item2 = await split(request, ids.Item2);
  expect(
    (await request.put(`/api/v1/reconciliation/${accountId}/cleared`, { headers, data: { split_ids: [item2.id], cleared: true } })).status(),
  ).toBe(200);
  const closed = await request.post(`/api/v1/reconciliation/${accountId}/close`, {
    headers,
    data: { statement_balance: "980.00", statement_date: "2026-03-31" },
  });
  expect(closed.status(), await closed.text()).toBe(201);

  await openTable(page);
  await check(page, "Item1").first().check();
  await check(page, "Item2").check();
  await bar(page).getByRole("button", { name: "Mudar data" }).click();
  await page.getByRole("dialog").getByLabel("Data").fill("2026-01-15");
  await page.getByRole("dialog").getByRole("button", { name: "Mudar data" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Nada foi alterado.");
  await expect(alert).toContainText("Travados: Item2 Massa E2E.");
  expect((await split(request, ids.Item1)).date).toBe("2026-03-10");
  expect((await split(request, ids.Item2)).date).toBe("2026-03-11");

  await alert.getByRole("button", { name: "Desmarcar os travados" }).click();
  await expect(alert).toHaveCount(0);
  await expect(bar(page).getByRole("status")).toHaveText("1 selecionado");
  await expect(check(page, "Item2")).not.toBeChecked();
});

test("excluir pede confirmacao e apaga so os marcados", async ({ page, request }) => {
  await openTable(page);
  await check(page, "Item3").check();
  await check(page, "Item4").check();
  await bar(page).getByRole("button", { name: "Excluir" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("2 lançamentos");
  await dialog.getByRole("button", { name: "Excluir" }).click();

  await expect(page.getByText("2 lançamentos excluídos.")).toBeVisible();
  await expect(rowOf(page, "Item3 Massa E2E")).toHaveCount(0);
  await expect(rowOf(page, "Item4 Massa E2E")).toHaveCount(0);
  const headers = await apiHeaders(request);
  expect((await request.get(`/api/v1/transactions/${ids.Item3}`, { headers })).status()).toBe(404);
  expect((await request.get(`/api/v1/transactions/${ids.Item1}`, { headers })).status()).toBe(200);
  // 1000 - Item1 (10) - copia (10) - Item2 (20)
  expect(await balance(request)).toBe("960.00");
});
