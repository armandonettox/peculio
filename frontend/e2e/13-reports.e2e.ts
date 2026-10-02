import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const ACCOUNT = "Conta Relatorios E2E";
const main = (page: Page) => page.getByRole("main");
const today = () => new Date().toLocaleDateString("sv-SE");

async function openReports(page: Page, { filterByAccount = false } = {}) {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Relatórios" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios" })).toBeVisible();
  if (filterByAccount) {
    // O token vive so na memoria: navegar pela URL desloga, entao o filtro entra pela tela
    await page.getByLabel("Conta", { exact: true }).selectOption({ label: ACCOUNT });
  }
}

const brl = (region: ReturnType<Page["getByRole"]>, label: string) => region.getByRole("group", { name: `${label} em BRL` });

test("prepara dados ficticios isolados numa conta so deste teste", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const account = await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    currency_code: "BRL",
    opening_balance: "1000.00",
    opening_balance_date: "2026-01-01",
  });
  const mercado = await apiPost(request, headers, "/categories", { name: "Mercado Rel E2E" });
  const lazer = await apiPost(request, headers, "/categories", { name: "Lazer Rel E2E" });
  const spend = (description: string, amount: string, categoryId: string | null) =>
    apiPost(request, headers, "/transactions", {
      splits: [
        {
          type: "withdrawal",
          date: today(),
          description,
          amount,
          currency_code: "BRL",
          account_id: account.id,
          counterparty_name: "Loja Relatorios",
          ...(categoryId ? { category_id: categoryId } : {}),
        },
      ],
    });
  await spend("Compra da semana", "100.00", mercado.id);
  await spend("Cinema", "40.00", lazer.id);
  // Comeca como formula: o CSV precisa neutralizar
  await spend("=1+1 formula", "10.00", null);
  await apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "deposit",
        date: today(),
        description: "Salario do mes",
        amount: "500.00",
        currency_code: "BRL",
        account_id: account.id,
        counterparty_name: "Empresa Relatorios",
      },
    ],
  });
});

test("este mes: totais da conta, grafico mensal e quebras por categoria", async ({ page }) => {
  await openReports(page, { filterByAccount: true });
  const report = main(page).getByRole("region", { name: "Relatório em BRL" });
  await expect(report).toBeVisible();
  await expect(brl(report, "Receita")).toContainText("R$ 500,00");
  await expect(brl(report, "Despesa")).toContainText("R$ 150,00");
  await expect(report).toContainText("Mercado Rel E2E");
  await expect(report).toContainText("Lazer Rel E2E");
  await expect(report).toContainText("Sem categoria");
  // Filtra o periodo pronto: o servidor resolve as datas pelo relogio do app
  await expect(page.getByLabel("Período")).toHaveValue("this-month");
});

test("filtrar por categoria reduz os totais", async ({ page }) => {
  await openReports(page, { filterByAccount: true });
  await page.getByLabel("Categoria", { exact: true }).selectOption({ label: "Mercado Rel E2E" });
  const report = main(page).getByRole("region", { name: "Relatório em BRL" });
  await expect(brl(report, "Despesa")).toContainText("R$ 100,00");
  await expect(brl(report, "Receita")).toContainText("R$ 0,00");
});

test("mes passado e vazio e oferece limpar os filtros", async ({ page }) => {
  await openReports(page, { filterByAccount: true });
  await page.getByLabel("Período").selectOption({ label: "Mês passado" });
  await expect(page.getByText("Nada neste período")).toBeVisible();
  await expect(page.getByRole("button", { name: "Limpar filtros" }).first()).toBeVisible();
  await page.getByLabel("Período").selectOption({ label: "Este mês" });
  await expect(main(page).getByRole("region", { name: "Relatório em BRL" })).toBeVisible();
});

test("periodo personalizado usa as datas digitadas e recusa data inicial depois da final", async ({ page }) => {
  await openReports(page, { filterByAccount: true });
  await page.getByLabel("Período").selectOption({ label: "Personalizado" });
  await page.getByLabel("Data inicial").fill("2026-01-01");
  await page.getByLabel("Data final").fill("2025-12-31");
  await expect(page.getByText("A data inicial é depois da data final.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
  await page.getByLabel("Data final").fill(today());
  const report = main(page).getByRole("region", { name: "Relatório em BRL" });
  await expect(report).toBeVisible();
  await expect(brl(report, "Despesa")).toContainText("R$ 150,00");
});

test("exportar CSV baixa so os lancamentos filtrados, com BOM, ponto e virgula e formula neutralizada", async ({ page }) => {
  await openReports(page, { filterByAccount: true });
  await expect(main(page).getByRole("region", { name: "Relatório em BRL" })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exportar CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^lancamentos-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  const text = readFileSync(path, "utf-8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const lines = text.slice(1).trim().split("\r\n");
  expect(lines[0]).toBe(
    "data;tipo;descricao;conta_origem;conta_destino;valor;moeda;valor_estrangeiro;moeda_estrangeira;categoria;orcamento;tags;notas",
  );
  // So a conta filtrada: 3 saidas e 1 entrada. O saldo inicial do sistema nao entra.
  expect(lines).toHaveLength(1 + 4);
  const body = lines.slice(1).join("\n");
  expect(body).toContain("Compra da semana");
  expect(body).toContain("100,00");
  expect(body).toContain("Mercado Rel E2E");
  expect(body).toContain("Salario do mes");
  // Descricao que comeca com "=" ganha apostrofo na frente
  expect(body).toContain(";'=1+1 formula;");
  expect(body).not.toContain(";=1+1 formula;");
  expect(body).not.toContain("Loja do outro");
});

test("no celular a pagina nao ganha rolagem horizontal e os valores negativos nao quebram de linha", async ({ page }) => {
  // Navega no tamanho normal (no celular o menu vira gaveta) e so depois encolhe a janela
  await openReports(page, { filterByAccount: true });
  await expect(main(page).getByRole("region", { name: "Relatório em BRL" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(main(page).getByRole("region", { name: "Relatório em BRL" })).toBeVisible();
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    window: window.innerWidth,
  }));
  expect(widths.page).toBeLessThanOrEqual(widths.window);
  // Despesa na linha de categoria: "-R$ 100,00" cabe numa linha so
  const negative = main(page).getByRole("cell", { name: "-R$ 100,00" }).first();
  await expect(negative).toBeVisible();
  const height = (await negative.boundingBox())?.height ?? 999;
  expect(height).toBeLessThan(60);
});
