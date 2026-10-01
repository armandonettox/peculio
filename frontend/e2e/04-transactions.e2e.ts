import { expect, test, type Page } from "@playwright/test";

import { apiHeaders, apiPost, ADMIN, field, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01-auth (que cria o administrador). Os testes seguem em ordem: o primeiro
// cria os dados pela API e os demais so olham a tela.
test.describe.configure({ mode: "serial" });

const LOTS = 27;

async function openTransactions(page: Page) {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Transações" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Transações" })).toBeVisible();
}

const main = (page: Page) => page.getByRole("main");
const rowOf = (page: Page, text: string) => main(page).getByText(text, { exact: true }).locator("xpath=ancestor::li[1]");
const openFilters = (page: Page) => page.getByRole("button", { name: /^Filtros/ }).click();

test("prepara os dados pela API: contas, categorias, tag e 32 lancamentos", async ({ request }) => {
  const headers = await apiHeaders(request);
  const brl = (await apiPost(request, headers, "/accounts", {
    name: "Conta E2E",
    type: "asset",
    currency_code: "BRL",
    opening_balance: "10000.00",
    opening_balance_date: "2026-01-01",
  })).id;
  const usd = (await apiPost(request, headers, "/accounts", {
    name: "Dolar E2E",
    type: "asset",
    currency_code: "USD",
  })).id;
  const renda = (await apiPost(request, headers, "/categories", { name: "Renda E2E", color: "#00A878" })).id;
  const moradia = (await apiPost(request, headers, "/categories", { name: "Moradia E2E", color: "#E11D48" })).id;
  const mercado = (await apiPost(request, headers, "/categories", { name: "Mercado E2E" })).id;
  const casa = (await apiPost(request, headers, "/categories", { name: "Casa E2E" })).id;
  const fixo = (await apiPost(request, headers, "/tags", { name: "fixo" })).id;

  const withdrawal = (date: string, description: string, amount: string, counterparty: string, extra = {}) => ({
    type: "withdrawal",
    date,
    description,
    amount,
    currency_code: "BRL",
    account_id: brl,
    counterparty_name: counterparty,
    ...extra,
  });

  await apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "deposit",
        date: "2026-03-05",
        description: "Salario de marco",
        amount: "3000.00",
        currency_code: "BRL",
        account_id: brl,
        counterparty_name: "Empregador E2E",
        category_id: renda,
      },
    ],
  });
  await apiPost(request, headers, "/transactions", {
    splits: [withdrawal("2026-03-04", "Aluguel de marco", "1200.00", "Imobiliaria E2E", { category_id: moradia, tag_ids: [fixo] })],
  });
  await apiPost(request, headers, "/transactions", {
    title: "Compras da semana",
    splits: [
      withdrawal("2026-03-03", "Frutas", "30.00", "Feira E2E", { category_id: mercado }),
      withdrawal("2026-03-03", "Limpeza", "20.00", "Feira E2E", { category_id: casa }),
    ],
  });
  await apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "transfer",
        date: "2026-03-02",
        description: "Envio para dolar",
        amount: "500.00",
        currency_code: "BRL",
        foreign_amount: "100.00",
        foreign_currency_code: "USD",
        account_id: brl,
        counterparty_account_id: usd,
      },
    ],
  });
  await apiPost(request, headers, "/transactions", {
    splits: [withdrawal("2026-03-01", "Hotel", "80.00", "Hotel E2E", { foreign_amount: "15.00", foreign_currency_code: "USD" })],
  });

  // 27 lancamentos mais antigos, um por dia: servem para testar "Carregar mais"
  for (let index = 1; index <= LOTS; index++) {
    const day = String(28 - index).padStart(2, "0");
    await apiPost(request, headers, "/transactions", {
      splits: [withdrawal(`2026-01-${day}`, `Lote ${String(index).padStart(2, "0")}`, "10.00", "Loja E2E")],
    });
  }

  // Confere o saldo calculado pelo backend: 10000 + 3000 - 1200 - 50 - 500 - 80 - 27 x 10
  const accounts = await (await request.get("/api/v1/accounts", { headers })).json();
  const balances = Object.fromEntries(accounts.items.map((a: { name: string; balance: string }) => [a.name, a.balance]));
  expect(balances["Conta E2E"]).toBe("10900.00");
  expect(balances["Dolar E2E"]).toBe("100.00");
});

test("o menu leva para Transacoes e a lista traz o total", async ({ page }) => {
  await openTransactions(page);
  await expect(page).toHaveURL("/transacoes");
  await expect(main(page).getByText("32 lançamentos")).toBeVisible();
});

test("os lancamentos aparecem agrupados por dia, do mais recente para o mais antigo", async ({ page }) => {
  await openTransactions(page);
  // allTextContents nao espera: so le depois de o primeiro dia aparecer na tela
  await expect(main(page).getByRole("heading", { level: 2 }).first()).toBeVisible();
  const days = await main(page).getByRole("heading", { level: 2 }).allTextContents();
  expect(days[0]).toMatch(/5 de março de 2026/);
  expect(days[1]).toMatch(/4 de março de 2026/);
  expect(days[4]).toMatch(/1 de março de 2026/);
  expect(days).toHaveLength(new Set(days).size);
});

test("entrada, saida, transferencia entre moedas e compra em outra moeda mostram o valor certo", async ({ page }) => {
  await openTransactions(page);

  const salary = rowOf(page, "Salario de marco");
  await expect(salary).toContainText("+R$ 3.000,00");
  await expect(salary).toContainText("Empregador E2E · Conta E2E");
  await expect(salary.getByText("Renda E2E", { exact: true })).toHaveAttribute("data-color", "#00A878");

  const rent = rowOf(page, "Aluguel de marco");
  await expect(rent).toContainText("-R$ 1.200,00");
  await expect(rent.getByText("Moradia E2E", { exact: true })).toHaveAttribute("data-color", "#E11D48");
  await expect(rent.getByText("#fixo", { exact: true })).toBeVisible();

  await expect(rowOf(page, "Envio para dolar")).toContainText("R$ 500,00 → US$ 100,00");
  await expect(rowOf(page, "Envio para dolar")).toContainText("Conta E2E → Dolar E2E");
  await expect(rowOf(page, "Hotel")).toContainText("Valor original: US$ 15,00");
});

test("lancamento dividido mostra o total, o numero de partes e cada linha", async ({ page }) => {
  await openTransactions(page);
  const split = rowOf(page, "Compras da semana");
  await expect(split).toContainText("Dividida em 2 · Conta E2E");
  await expect(split).toContainText("-R$ 50,00");
  await expect(split.getByText("Frutas", { exact: true })).toBeVisible();
  await expect(split.getByText("-R$ 30,00")).toBeVisible();
  await expect(split.getByText("Mercado E2E", { exact: true })).toBeVisible();
  await expect(split.getByText("Casa E2E", { exact: true })).toBeVisible();
});

test("Carregar mais traz a segunda pagina sem repetir lancamentos", async ({ page }) => {
  await openTransactions(page);
  // Pagina 1: 25 lancamentos = os 5 de marco + Lote 01 a Lote 20
  await expect(rowOf(page, "Lote 20")).toBeVisible();
  await expect(main(page).getByText("Lote 21", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Carregar mais" }).click();
  await expect(rowOf(page, "Lote 27")).toBeVisible();
  await expect(page.getByRole("button", { name: "Carregar mais" })).toHaveCount(0);
  for (const label of ["Lote 01", "Lote 20", "Lote 21", "Lote 27"]) {
    await expect(main(page).getByText(label, { exact: true })).toHaveCount(1);
  }
});

test("a busca filtra pelo texto e grava na URL", async ({ page }) => {
  await openTransactions(page);
  await page.getByLabel("Buscar lançamentos").fill("aluguel");
  await expect(main(page).getByText("1 lançamento com os filtros escolhidos")).toBeVisible();
  await expect(rowOf(page, "Aluguel de marco")).toBeVisible();
  await expect(main(page).getByText("Salario de marco", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/busca=aluguel/);
});

test("filtra por categoria, por tag e por conta", async ({ page }) => {
  await openTransactions(page);
  await openFilters(page);

  await page.getByLabel("Categoria", { exact: true }).selectOption({ label: "Moradia E2E" });
  await expect(main(page).getByText("1 lançamento com os filtros escolhidos")).toBeVisible();
  await expect(rowOf(page, "Aluguel de marco")).toBeVisible();

  await page.getByLabel("Categoria", { exact: true }).selectOption({ label: "Todas" });
  await page.getByLabel("Tag", { exact: true }).selectOption({ label: "fixo" });
  await expect(main(page).getByText("1 lançamento com os filtros escolhidos")).toBeVisible();

  await page.getByLabel("Tag", { exact: true }).selectOption({ label: "Todas" });
  await page.getByLabel("Conta", { exact: true }).selectOption({ label: "Dolar E2E" });
  // So a transferencia mexe na conta em dolar
  await expect(main(page).getByText("1 lançamento com os filtros escolhidos")).toBeVisible();
  await expect(rowOf(page, "Envio para dolar")).toBeVisible();
});

test("filtra por periodo e por valor (formato brasileiro)", async ({ page }) => {
  await openTransactions(page);
  await openFilters(page);

  await page.getByLabel("Data inicial").fill("2026-03-03");
  await page.getByLabel("Data final").fill("2026-03-04");
  await expect(main(page).getByText("2 lançamentos com os filtros escolhidos")).toBeVisible();

  await page.getByLabel("Valor mínimo").fill("1.000,00");
  await expect(main(page).getByText("1 lançamento com os filtros escolhidos")).toBeVisible();
  await expect(rowOf(page, "Aluguel de marco")).toBeVisible();
  await expect(page).toHaveURL(/min=1000\.00/);
});

test("periodo invalido e valor invalido mostram o erro", async ({ page }) => {
  await openTransactions(page);
  await openFilters(page);
  await page.getByLabel("Data inicial").fill("2026-05-01");
  await page.getByLabel("Data final").fill("2026-04-01");
  await expect(page.getByText("A data inicial é depois da data final.")).toBeVisible();

  await page.getByLabel("Data inicial").fill("");
  await page.getByLabel("Data final").fill("");
  await page.getByLabel("Valor máximo").fill("abc");
  await expect(page.getByText("Valor inválido.")).toBeVisible();
});

test("Limpar filtros volta a lista inteira", async ({ page }) => {
  await openTransactions(page);
  await page.getByLabel("Buscar lançamentos").fill("zzzz");
  await expect(main(page).getByText("Nada encontrado")).toBeVisible();
  await page.getByRole("button", { name: "Limpar filtros" }).first().click();
  await expect(main(page).getByText("32 lançamentos")).toBeVisible();
  await expect(page.getByLabel("Buscar lançamentos")).toHaveValue("");
  await expect(page).toHaveURL(/\/transacoes$/);
});

test("um link com filtros funciona depois do login e guarda a consulta", async ({ page }) => {
  await page.goto("/transacoes?busca=Lote%2005");
  await expect(page).toHaveURL(/\/login\?next=/);
  await field(page, "E-mail").fill(ADMIN.email);
  await field(page, "Senha").fill(ADMIN.password);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/transacoes\?busca=Lote(%20|\+)05/);
  await expect(main(page).getByText("1 lançamento com os filtros escolhidos")).toBeVisible();
  await expect(rowOf(page, "Lote 05")).toBeVisible();
});

test("o saldo das contas na tela de Contas bate com os lancamentos", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Contas" }).click();
  const card = (name: string) =>
    page.getByRole("heading", { level: 3, name, exact: true }).locator("xpath=ancestor::li");
  await expect(card("Conta E2E")).toContainText("R$ 10.900,00");
  await expect(card("Dolar E2E")).toContainText("US$ 100,00");
});

test("no celular o painel de filtros abre e cabe na tela", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await loginAndWaitForDashboard(page);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Transações" }).click();
  await expect(main(page).getByText("32 lançamentos")).toBeVisible();

  const toggle = page.getByRole("button", { name: "Filtros" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Data inicial")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
