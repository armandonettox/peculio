import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const ACCOUNT = "Conta Personalizado E2E";
const NAME = "Mensal Personalizado E2E";
const today = () => new Date().toLocaleDateString("sv-SE");
const saved = (page: Page) => page.getByRole("region", { name: "Relatórios salvos" });
const dialog = (page: Page) => page.getByRole("dialog");

let categoryId = "";
let spareCategoryId = "";

async function savedReports(request: APIRequestContext) {
  const response = await request.get("/api/v1/reports/saved", { headers: await apiHeaders(request) });
  expect(response.status()).toBe(200);
  return response.json();
}

// Entra pelo menu (o token fica so em memoria), abre a aba Personalizado e isola os dados deste teste pela conta
async function openCustom(page: Page, { filterByAccount = true } = {}) {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Relatórios" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios" })).toBeVisible();
  await page.getByRole("tab", { name: "Personalizado" }).click();
  await expect(page.getByRole("region", { name: "Montar relatório" })).toBeVisible();
  if (filterByAccount) await page.getByLabel("Conta", { exact: true }).selectOption({ label: ACCOUNT });
}

test("prepara a conta, as categorias e os lancamentos pela API", async ({ request }) => {
  const headers = await apiHeaders(request);
  const account = await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    currency_code: "BRL",
    opening_balance: "1000.00",
    opening_balance_date: "2026-01-01",
  });
  categoryId = (await apiPost(request, headers, "/categories", { name: "Mercado Pers E2E", kind: "expense" })).id;
  spareCategoryId = (await apiPost(request, headers, "/categories", { name: "Descartavel Pers E2E", kind: "expense" })).id;
  const lazer = (await apiPost(request, headers, "/categories", { name: "Lazer Pers E2E", kind: "expense" })).id;
  const add = (type: string, description: string, amount: string, who: string, category: string | null) =>
    apiPost(request, headers, "/transactions", {
      splits: [
        {
          type,
          date: today(),
          description,
          amount,
          currency_code: "BRL",
          account_id: account.id,
          counterparty_name: who,
          ...(category ? { category_id: category } : {}),
        },
      ],
    });
  await add("withdrawal", "Compra A Pers E2E", "100.00", "Mercado Central Pers E2E", categoryId);
  await add("withdrawal", "Compra B Pers E2E", "50.00", "Cinema Pers E2E", lazer);
  await add("deposit", "Salario Pers E2E", "1000.00", "Empresa Pers E2E", null);
});

test("o relatorio comeca em despesas por categoria, com grafico e a tabela completa", async ({ page }) => {
  await openCustom(page);
  const report = page.getByRole("region", { name: "Despesas por categoria em BRL", exact: true });
  await expect(report).toBeVisible();
  await expect(report.locator('[data-chart="donut"]')).toBeVisible();
  const table = report.getByRole("table", { name: /todos os grupos/ });
  await expect(table.getByRole("rowheader", { name: "Mercado Pers E2E" })).toBeVisible();
  await expect(table.getByRole("rowheader", { name: "Lazer Pers E2E" })).toBeVisible();
  // O salario nao tem categoria e nao e despesa: nao aparece em despesas
  await expect(page.getByText(/Período:/)).toBeVisible();
});

test("trocar o agrupamento e o grafico muda o relatorio e escolhe um grafico que sirva", async ({ page }) => {
  await openCustom(page);
  await expect(page.getByRole("region", { name: "Despesas por categoria em BRL", exact: true })).toBeVisible();

  await page.getByLabel("Gráfico").selectOption("bar");
  const bars = page.getByRole("list", { name: "Despesas por categoria em BRL" });
  await expect(bars.getByRole("listitem")).toHaveCount(2);

  await page.getByLabel("Agrupar por").selectOption("counterparty");
  const byWho = page.getByRole("region", { name: "Despesas por contraparte em BRL", exact: true });
  await expect(byWho.getByRole("rowheader", { name: "Mercado Central Pers E2E" })).toBeVisible();
  await expect(byWho.getByRole("rowheader", { name: "Cinema Pers E2E" })).toBeVisible();

  // Receitas: so a contraparte que recebeu
  await page.getByLabel("Medir").selectOption("income");
  await expect(page.getByRole("list", { name: "Receitas por contraparte em BRL" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Receitas por contraparte em BRL" })).toContainText("Empresa Pers E2E");

  // Mes: a rosca e a barra de categoria deixam de servir e vira linha
  await page.getByLabel("Gráfico").selectOption("bar");
  await page.getByLabel("Agrupar por").selectOption("month");
  await page.getByLabel("Gráfico").selectOption("line");
  await expect(
    page.getByRole("region", { name: "Receitas mês a mês em BRL", exact: true }).locator('[data-chart="line"]'),
  ).toBeVisible();
  await expect(page.getByLabel("Gráfico").locator("option")).toHaveText(["Tabela", "Barras", "Linha"]);

  // Saldo com rosca nao serve: ao voltar para categoria o grafico e trocado
  await page.getByLabel("Agrupar por").selectOption("category");
  await expect(page.getByLabel("Gráfico")).toHaveValue("bar");
});

test("datas fixas pedem as duas datas", async ({ page }) => {
  await openCustom(page);
  await page.getByLabel("Período").selectOption("fixed");
  await expect(page.getByText("Informe as duas datas.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar relatório" })).toBeDisabled();
  await page.getByLabel("Data inicial").fill(`${today().slice(0, 4)}-01-01`);
  await page.getByLabel("Data final").fill(today());
  await expect(page.getByRole("region", { name: "Despesas por categoria em BRL", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar relatório" })).toBeEnabled();
});

test("salvar, reabrir e atualizar um relatorio", async ({ page, request }) => {
  await openCustom(page);
  await page.getByLabel("Agrupar por").selectOption("counterparty");
  await page.getByLabel("Gráfico").selectOption("bar");
  await page.getByLabel("Período").selectOption("last-3-months");
  await page.getByRole("button", { name: "Salvar relatório" }).click();
  await dialog(page).getByLabel("Nome").fill(NAME);
  await dialog(page).getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Relatório salvo.")).toBeVisible();
  await expect(saved(page).getByRole("button", { name: `Abrir ${NAME}` })).toBeVisible();

  const list = await savedReports(request);
  const mine = list.find((item: { name: string }) => item.name === NAME);
  expect(mine).toMatchObject({ group_by: "counterparty", chart: "bar", measure: "expense", period: "last-3-months" });
  expect(mine.account_id).not.toBeNull();

  // Outra vez do zero: abrir o relatorio devolve a configuracao
  await openCustom(page, { filterByAccount: false });
  await saved(page).getByRole("button", { name: `Abrir ${NAME}` }).click();
  await expect(page.getByLabel("Agrupar por")).toHaveValue("counterparty");
  await expect(page.getByLabel("Gráfico")).toHaveValue("bar");
  await expect(page.getByLabel("Período")).toHaveValue("last-3-months");
  await expect(page.getByText(/Aberto:/)).toContainText(NAME);
  await expect(page.getByRole("region", { name: "Despesas por contraparte em BRL", exact: true })).toBeVisible();

  // Mudar e atualizar
  await page.getByLabel("Medir").selectOption("income");
  await expect(page.getByText(/com mudanças ainda não salvas/)).toBeVisible();
  await page.getByRole("button", { name: "Salvar relatório" }).click();
  await expect(dialog(page).getByLabel("Atualizar “Mensal Personalizado E2E”")).toBeChecked();
  await dialog(page).getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Relatório salvo.")).toBeVisible();
  const updated = (await savedReports(request)).find((item: { name: string }) => item.name === NAME);
  expect(updated.measure).toBe("income");
  expect((await savedReports(request)).filter((item: { name: string }) => item.name === NAME)).toHaveLength(1);
});

test("nome repetido e recusado no campo", async ({ page }) => {
  await openCustom(page);
  await page.getByRole("button", { name: "Salvar relatório" }).click();
  await dialog(page).getByLabel("Nome").fill(NAME.toLowerCase());
  await dialog(page).getByRole("button", { name: "Salvar" }).click();
  await expect(dialog(page).getByText("Já existe um relatório salvo com esse nome.")).toBeVisible();
  await expect(dialog(page)).toBeVisible();
});

test("um relatorio que filtra por uma categoria excluida avisa", async ({ page, request }) => {
  const headers = await apiHeaders(request);
  await apiPost(request, headers, "/reports/saved", {
    name: "Com categoria Pers E2E",
    group_by: "category",
    chart: "table",
    measure: "expense",
    period: "this-month",
    category_id: spareCategoryId,
  });
  expect((await request.delete(`/api/v1/categories/${spareCategoryId}`, { headers })).status()).toBe(204);

  await openCustom(page, { filterByAccount: false });
  await saved(page).getByRole("button", { name: "Abrir Com categoria Pers E2E" }).click();
  await expect(page.getByText(/filtra por categoria que não existe mais/)).toBeVisible();
});

test("excluir um relatorio salvo pede confirmacao", async ({ page, request }) => {
  await openCustom(page, { filterByAccount: false });
  await saved(page).getByRole("button", { name: `Excluir ${NAME}` }).click();
  await expect(dialog(page)).toContainText(NAME);
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("Relatório excluído.")).toBeVisible();
  await expect(saved(page).getByRole("button", { name: `Abrir ${NAME}` })).toHaveCount(0);
  expect((await savedReports(request)).some((item: { name: string }) => item.name === NAME)).toBe(false);
  expect(categoryId).not.toBe("");
});

test("a aba Resumo continua como antes", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Relatórios" }).click();
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Montar relatório" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Resumo" })).toHaveAttribute("aria-selected", "true");
});
