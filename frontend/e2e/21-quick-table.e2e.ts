import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const ACCOUNT = "Conta Tabela E2E";
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });
const entry = (page: Page) => page.getByRole("row", { name: "Novo lançamento" });
const rowOf = (page: Page, text: string) => page.getByRole("row", { name: new RegExp(`^${text}`) });

let accountId = "";
let mercadoId = "";

async function balance(request: APIRequestContext): Promise<string> {
  const response = await request.get(`/api/v1/accounts/${accountId}`, { headers: await apiHeaders(request) });
  expect(response.status()).toBe(200);
  return (await response.json()).balance;
}

async function transaction(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/v1/transactions/${id}`, { headers: await apiHeaders(request) });
  expect(response.status()).toBe(200);
  return response.json();
}

// Abre a pagina pelo menu (o token fica so em memoria) e mostra so os lancamentos deste teste
async function openTable(page: Page) {
  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Transações" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Transações" })).toBeVisible();
  await page.getByLabel("Buscar lançamentos").fill("Tabela E2E");
  // O filtro entra com um pequeno atraso e a lista recarrega: espera isso acabar antes de abrir uma linha
  await expect(page.getByText(/com os filtros escolhidos/)).toBeVisible();
  await page.getByRole("button", { name: "Tabela", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
}

async function fillEntry(page: Page, { date = "2026-03-15", description, counterparty, amount }: { date?: string; description: string; counterparty: string; amount: string }) {
  const row = entry(page);
  await row.getByLabel("Data").fill(date);
  await row.getByLabel("Descrição").fill(description);
  await row.getByLabel("Contraparte").fill(counterparty);
  await row.getByLabel("Conta").selectOption({ label: ACCOUNT });
  await row.getByLabel("Valor").fill(amount);
}

test("prepara a conta e os lancamentos pela API", async ({ request }) => {
  const headers = await apiHeaders(request);
  const account = await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    currency_code: "BRL",
    opening_balance: "1000.00",
    opening_balance_date: "2026-01-01",
  });
  accountId = account.id;
  const split = (type: string, description: string, amount: string, date: string) => ({
    type,
    date,
    description,
    amount,
    currency_code: "BRL",
    account_id: accountId,
    counterparty_name: "Loja",
  });
  const mercado = await apiPost(request, headers, "/transactions", { splits: [split("withdrawal", "Mercado Tabela E2E", "100.00", "2026-03-10")] });
  mercadoId = mercado.id;
  await apiPost(request, headers, "/transactions", {
    title: "Dividida Tabela E2E",
    splits: [split("withdrawal", "Parte A Tabela E2E", "10.00", "2026-03-11"), split("withdrawal", "Parte B Tabela E2E", "20.00", "2026-03-11")],
  });
});

test("a tabela mostra os lancamentos e o teclado anda entre as linhas", async ({ page }) => {
  await openTable(page);
  await expect(rowOf(page, "Mercado Tabela E2E")).toBeVisible();
  await expect(rowOf(page, "Dividida Tabela E2E")).toContainText("Dividida em 2");

  // Datas: a dividida e de 11/03 e vem antes do mercado, de 10/03
  await rowOf(page, "Dividida Tabela E2E").focus();
  await page.keyboard.press("ArrowDown");
  await expect(rowOf(page, "Mercado Tabela E2E")).toBeFocused();
  await page.keyboard.press("k");
  await expect(rowOf(page, "Dividida Tabela E2E")).toBeFocused();
  await page.keyboard.press("End");
  await expect(rowOf(page, "Mercado Tabela E2E")).toBeFocused();
});

test("a linha de entrada pede o que falta e so grava quando esta completa", async ({ page, request }) => {
  await openTable(page);
  await page.getByRole("button", { name: "Nova linha" }).click();
  await expect(entry(page).getByLabel("Data")).toBeFocused();

  await entry(page).getByLabel("Descrição").fill("Cafe Tabela E2E");
  await page.keyboard.press("Enter");
  await expect(entry(page).getByText("Informe a contraparte.")).toBeVisible();
  await expect(entry(page).getByLabel("Contraparte")).toBeFocused();
  expect(await balance(request)).toBe("870.00");
});

test("Enter grava e deixa uma linha nova na mesma data e conta; Ctrl+Enter grava e fecha", async ({ page, request }) => {
  await openTable(page);
  await page.getByRole("button", { name: "Nova linha" }).click();
  await fillEntry(page, { description: "Cafe Tabela E2E", counterparty: "Cafeteria", amount: "-25,00" });
  await entry(page).getByLabel("Valor").press("Enter");

  await expect(rowOf(page, "Cafe Tabela E2E")).toBeVisible();
  await expect(entry(page).getByLabel("Descrição")).toHaveValue("");
  await expect(entry(page).getByLabel("Descrição")).toBeFocused();
  await expect(entry(page).getByLabel("Data")).toHaveValue("2026-03-15");
  await expect(entry(page).getByLabel("Conta")).toHaveValue(accountId);
  expect(await balance(request)).toBe("845.00");

  await entry(page).getByLabel("Descrição").fill("Salario Tabela E2E");
  await entry(page).getByLabel("Contraparte").fill("Empresa");
  await entry(page).getByLabel("Valor").fill("500,00");
  await expect(entry(page).getByText("Entrada")).toBeVisible();
  await entry(page).getByLabel("Valor").press("Control+Enter");

  await expect(entry(page)).toHaveCount(0);
  await expect(rowOf(page, "Salario Tabela E2E")).toContainText("+R$");
  await expect(page.getByRole("button", { name: "Nova linha" })).toBeFocused();
  expect(await balance(request)).toBe("1345.00");
});

test("Esc cancela a linha de entrada sem gravar", async ({ page, request }) => {
  await openTable(page);
  await page.getByRole("button", { name: "Nova linha" }).click();
  await fillEntry(page, { description: "Descartada Tabela E2E", counterparty: "Loja", amount: "-1,00" });
  await entry(page).getByLabel("Valor").press("Escape");
  await expect(entry(page)).toHaveCount(0);
  await expect(rowOf(page, "Descartada Tabela E2E")).toHaveCount(0);
  expect(await balance(request)).toBe("1345.00");
});

test("Enter numa linha edita ali mesmo e o foco desce", async ({ page, request }) => {
  await openTable(page);
  await rowOf(page, "Cafe Tabela E2E").focus();
  await page.keyboard.press("Enter");
  const editing = page.getByRole("row", { name: "Editando Cafe Tabela E2E" });
  await expect(editing.getByLabel("Descrição")).toBeFocused();
  await expect(editing.getByLabel("Valor")).toHaveValue("-25,00");

  await editing.getByLabel("Valor").fill("-30,00");
  await editing.getByLabel("Valor").press("Enter");
  await expect(rowOf(page, "Cafe Tabela E2E")).toContainText("30,00");
  expect(await balance(request)).toBe("1340.00");
  // A linha de baixo (por data) e a seguinte na tabela
  await expect(page.locator("tbody tr[tabindex]:focus")).toHaveCount(1);
});

test("editar na linha nao perde o que ela nao mostra", async ({ page, request }) => {
  const headers = await apiHeaders(request);
  const tag = await apiPost(request, headers, "/tags", { name: "tabela-e2e" });
  const current = await transaction(request, mercadoId);
  const base = current.splits[0];
  const put = await request.put(`/api/v1/transactions/${mercadoId}`, {
    headers,
    data: {
      splits: [
        {
          type: "withdrawal",
          date: base.date,
          description: base.description,
          amount: base.amount,
          currency_code: "BRL",
          account_id: accountId,
          counterparty_name: "Loja",
          tag_ids: [tag.id],
          notes: "nota que a linha nao mostra",
        },
      ],
    },
  });
  expect(put.status()).toBe(200);

  await openTable(page);
  await rowOf(page, "Mercado Tabela E2E").focus();
  await page.keyboard.press("Enter");
  const editing = page.getByRole("row", { name: "Editando Mercado Tabela E2E" });
  await editing.getByLabel("Descrição").fill("Mercado Tabela E2E editado");
  await editing.getByLabel("Descrição").press("Enter");
  await expect(rowOf(page, "Mercado Tabela E2E editado")).toBeVisible();

  const saved = (await transaction(request, mercadoId)).splits[0];
  expect(saved.description).toBe("Mercado Tabela E2E editado");
  expect(saved.tag_ids).toEqual([tag.id]);
  expect(saved.notes).toBe("nota que a linha nao mostra");
});

test("Esc cancela a edicao, e lancamento dividido abre o formulario completo", async ({ page }) => {
  await openTable(page);
  await rowOf(page, "Cafe Tabela E2E").focus();
  await page.keyboard.press("Enter");
  const editing = page.getByRole("row", { name: "Editando Cafe Tabela E2E" });
  await editing.getByLabel("Descrição").fill("Mudou mas nao grava");
  await editing.getByLabel("Descrição").press("Escape");
  await expect(rowOf(page, "Cafe Tabela E2E")).toBeFocused();
  await expect(rowOf(page, "Mudou mas nao grava")).toHaveCount(0);

  await rowOf(page, "Dividida Tabela E2E").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("row", { name: /^Editando/ })).toHaveCount(0);
});

test("o botao Atalhos lista as teclas e a escolha da tabela fica lembrada", async ({ page }) => {
  await openTable(page);
  await page.getByRole("button", { name: "Atalhos" }).click();
  const dialog = page.getByRole("dialog", { name: "Atalhos da tabela" });
  await expect(dialog).toContainText("Gravar e fechar a linha nova");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // A escolha fica no navegador: ao voltar para a pagina (sem recarregar), a tabela continua
  await nav(page).getByRole("link", { name: "Painel" }).click();
  await nav(page).getByRole("link", { name: "Transações" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page.getByRole("table")).toHaveCount(0);
});
