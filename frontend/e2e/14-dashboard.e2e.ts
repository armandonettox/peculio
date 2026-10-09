import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois dos outros (o banco e compartilhado): as contas e os lancamentos dos arquivos anteriores
// tambem entram nos totais, entao aqui se confere o que e proprio deste teste e a coerencia com a API.
test.describe.configure({ mode: "serial" });

const main = (page: Page) => page.getByRole("main");
const block = (page: Page, title: string) => main(page).getByRole("region", { name: title, exact: true });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
// O Intl separa o simbolo do numero com espaco sem quebra; a tela usa o mesmo formatador
const money = (value: string) => brl.format(Number(value));

const today = () => new Date().toLocaleDateString("sv-SE");
const addDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("sv-SE");
};

async function openDashboard(page: Page) {
  await loginAndWaitForDashboard(page);
  await expect(page.getByRole("region", { name: "Patrimônio em BRL" })).toBeVisible();
}

async function api(request: APIRequestContext, path: string) {
  const headers = await apiHeaders(request, ADMIN);
  const response = await request.get(`/api/v1${path}`, { headers });
  expect(response.status()).toBe(200);
  return response.json();
}

const state = { accountId: "" };

test("prepara dados ficticios: conta, divida, orcamento perto do limite, conta atrasada, recorrente e cofrinho", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const account = await apiPost(request, headers, "/accounts", {
    name: "Conta Painel E2E", type: "asset", currency_code: "BRL", opening_balance: "4000.00", opening_balance_date: "2026-01-01",
  });
  state.accountId = account.id;
  await apiPost(request, headers, "/accounts", {
    name: "Cartao Painel E2E", type: "liability", currency_code: "BRL", opening_balance: "750.00", opening_balance_date: "2026-01-01",
  });
  const mercado = await apiPost(request, headers, "/categories", { name: "Mercado Painel E2E", kind: "expense" });
  const budget = await apiPost(request, headers, "/budgets", {
    name: "Mercado Painel E2E", currency_code: "BRL", amount: "500.00", period: "monthly",
  });
  const spend = (description: string, amount: string, extra = {}) =>
    apiPost(request, headers, "/transactions", {
      splits: [{
        type: "withdrawal", date: today(), description, amount, currency_code: "BRL", account_id: account.id,
        counterparty_name: "Loja Painel E2E", category_id: mercado.id, ...extra,
      }],
    });
  // 480 de 500: 96% do limite, no alto da lista de orcamentos e na faixa de alertas
  await spend("Compra do mes no painel", "480.00", { budget_id: budget.id });
  // Uma despesa em dolar sem receita no mes: o resultado fica negativo ("-US$ 29,90"), que e o caso que quebrava de linha
  const wise = await apiPost(request, headers, "/accounts", {
    name: "Wise Painel E2E", type: "asset", currency_code: "USD", opening_balance: "300.00", opening_balance_date: "2026-01-01",
  });
  await apiPost(request, headers, "/transactions", {
    splits: [{ type: "withdrawal", date: today(), description: "Software Painel E2E", amount: "29.90", currency_code: "USD", account_id: wise.id, counterparty_name: "Loja Exterior Painel" }],
  });
  await apiPost(request, headers, "/bills", {
    name: "Aluguel Painel E2E", currency_code: "BRL", amount_min: "1200.00", amount_max: "1200.00",
    match_text: "zzz-nunca-casa-painel", first_due_date: addDays(-8), frequency: "monthly",
  });
  await apiPost(request, headers, "/bills", {
    name: "Internet Painel E2E", currency_code: "BRL", amount_min: "100.00", amount_max: "120.00",
    match_text: "zzz-nunca-casa-internet", first_due_date: addDays(6), frequency: "monthly",
  });
  await apiPost(request, headers, "/recurrences", {
    name: "Mesada Painel E2E", frequency: "monthly", first_date: addDays(9),
    template: { splits: [{ type: "withdrawal", date: addDays(9), description: "Mesada", amount: "50.00", currency_code: "BRL", account_id: account.id, counterparty_name: "Filho" }] },
  });
  const piggy = await apiPost(request, headers, "/piggy-banks", {
    name: "Viagem Painel E2E", account_id: account.id, target_amount: "2000.00",
  });
  const added = await request.post(`/api/v1/piggy-banks/${piggy.id}/events`, { headers, data: { kind: "add", amount: "500.00" } });
  expect(added.status()).toBe(201);
});

test("mostra todos os blocos com os dados do usuario", async ({ page }) => {
  await openDashboard(page);
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
  for (const title of ["Patrimônio", "Este mês", "Gastos por categoria", "Orçamentos", "Próximos vencimentos", "Últimas transações", "Cofrinhos"]) {
    await expect(block(page, title)).toBeVisible();
  }
  await expect(block(page, "Orçamentos")).toContainText("Mercado Painel E2E");
  await expect(block(page, "Orçamentos").getByRole("progressbar", { name: "Gasto de Mercado Painel E2E" })).toHaveAttribute("aria-valuenow", "96");
  await expect(block(page, "Cofrinhos")).toContainText("Viagem Painel E2E");
  await expect(block(page, "Últimas transações")).toContainText("Compra do mes no painel");
});

test("vencimentos: a conta atrasada aparece destacada por texto, e a que vence logo e a recorrente tambem", async ({ page }) => {
  await openDashboard(page);
  const upcoming = block(page, "Próximos vencimentos");
  const overdue = upcoming.getByRole("listitem").filter({ hasText: "Aluguel Painel E2E" });
  await expect(overdue).toContainText("Atrasada");
  await expect(overdue).toContainText(money("1200"));
  await expect(upcoming.getByRole("listitem").filter({ hasText: "Internet Painel E2E" })).not.toContainText("Atrasada");
  await expect(upcoming.getByRole("listitem").filter({ hasText: "Mesada Painel E2E" })).toBeVisible();
  // Atrasadas vem primeiro
  const names = await upcoming.getByRole("listitem").locator("p.font-medium").allTextContents();
  expect(names.indexOf("Aluguel Painel E2E")).toBeLessThan(names.indexOf("Internet Painel E2E"));
});

test("alertas: conta atrasada e orcamento perto do limite aparecem no topo e os links levam as telas certas", async ({ page }) => {
  await openDashboard(page);
  const alerts = page.getByRole("region", { name: "Alertas" });
  await expect(alerts).toContainText(/conta(s)? atrasada/);
  await expect(alerts).toContainText(/orçamento(s)? perto do limite/);
  await alerts.getByRole("link", { name: /atrasada/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contas a pagar" })).toBeVisible();
});

test("patrimonio: os totais e a serie da tela batem com a API e o grafico tem tabela para leitor de tela", async ({ page, request }) => {
  const data = await api(request, "/dashboard/net-worth?months=12");
  const brlData = data.currencies.find((item: { currency_code: string }) => item.currency_code === "BRL");
  await openDashboard(page);
  const section = page.getByRole("region", { name: "Patrimônio em BRL" });
  await expect(section).toContainText(money(brlData.net));
  await expect(section).toContainText(money(brlData.assets));
  await expect(section).toContainText(money(brlData.liabilities));
  // O grafico real (SVG) e a tabela equivalente com um ponto por mes
  const chart = section.getByRole("img", { name: /Patrimônio líquido em BRL/ }).first();
  await expect(chart).toBeVisible();
  const table = section.getByRole("table", { name: "Patrimônio líquido em BRL" });
  await expect(table.getByRole("row")).toHaveCount(brlData.series.length + 1);
  expect(brlData.series).toHaveLength(12);
  // O ultimo ponto da serie e o saldo de hoje
  expect(brlData.series[11].net).toBe(brlData.net);
});

test("categorias: a rosca mostra a categoria do usuario e o link vai para os relatorios", async ({ page }) => {
  await openDashboard(page);
  const block_ = block(page, "Gastos por categoria");
  await expect(block_).toContainText("Mercado Painel E2E");
  await block_.getByRole("link", { name: "Ver relatórios" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios" })).toBeVisible();
});

test("criar uma conta a pagar pela tela atualiza o painel ao voltar a ele", async ({ page }) => {
  await openDashboard(page);
  await expect(block(page, "Próximos vencimentos")).not.toContainText("Gas Painel E2E");
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await nav.getByRole("link", { name: "Contas a pagar", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contas a pagar" })).toBeVisible();
  await page.getByRole("button", { name: "Nova conta a pagar" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill("Gas Painel E2E");
  await dialog.getByLabel("Valor mínimo").fill("30,00");
  await dialog.getByLabel("Valor máximo").fill("45,00");
  await dialog.getByLabel("Primeiro vencimento").fill(addDays(3));
  await dialog.getByRole("button", { name: "Criar conta a pagar" }).click();
  await expect(dialog).toBeHidden();
  // A mutacao invalida o cache do painel: ao voltar, os vencimentos ja trazem a conta nova
  await nav.getByRole("link", { name: "Painel" }).click();
  await expect(block(page, "Próximos vencimentos")).toContainText("Gas Painel E2E");
});

test("no celular a pagina nao ganha rolagem horizontal e os blocos empilham", async ({ page }) => {
  await openDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(block(page, "Orçamentos")).toBeVisible();
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.window);
  const first = await block(page, "Este mês").boundingBox();
  const second = await block(page, "Gastos por categoria").boundingBox();
  // Empilhados: o segundo comeca abaixo do primeiro, nao ao lado
  expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
  // Na tabela "Este mes" o valor fica numa linha so (nao quebra o sinal de menos nem o simbolo da moeda).
  // Conta as linhas de texto da celula: a altura da celula e a da linha da tabela, que a coluna da diferenca estica.
  const lines = await block(page, "Este mês").locator("tbody tr td:first-of-type").evaluateAll((cells) =>
    cells.map((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
    }),
  );
  expect(lines.length).toBeGreaterThan(0);
  for (const count of lines) expect(count).toBe(1);
});

test("teclado: o grafico de patrimonio tem uma parada de Tab e as setas percorrem os pontos", async ({ page }) => {
  await openDashboard(page);
  const section = page.getByRole("region", { name: "Patrimônio em BRL" });
  const points = section.locator("[data-point]");
  await expect(points).toHaveCount(12);
  // Uma parada de Tab so, nao uma por ponto
  await expect(section.locator("[data-point][tabindex='0']")).toHaveCount(1);

  await section.locator("[data-point][tabindex='0']").focus();
  const tooltip = section.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  const firstText = (await tooltip.textContent()) ?? "";

  await page.keyboard.press("ArrowRight");
  await expect(points.nth(1)).toBeFocused();
  await expect(tooltip).toBeVisible();
  expect((await tooltip.textContent()) ?? "").not.toBe(firstText);

  await page.keyboard.press("End");
  await expect(points.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(points.first()).toBeFocused();

  // Escape esconde o tooltip e o foco continua no ponto
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(points.first()).toBeFocused();
});
