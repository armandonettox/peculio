import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Planejamento Personalizado: orcamento com periodo por datas e categorias, as abas Ativos e Expirados e o gasto que vem
// da categoria (sem ligar lancamento a lancamento). Em ordem: cada passo parte do anterior.
test.describe.configure({ mode: "serial" });

const CATEGORY = "Viagem Cat E2E";
const PAST = "Viagem Marco E2E";
const CURRENT = "Viagem Atual E2E";

const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const card = (page: Page, name: string) => main(page).getByRole("heading", { level: 2, name }).locator("xpath=ancestor::li[1]");
// O app usa o "hoje" do servidor (America/Sao_Paulo): o executor pode estar em outro fuso
const today = (plusDays = 0) => {
  const base = new Date(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) + "T12:00:00Z");
  base.setUTCDate(base.getUTCDate() + plusDays);
  return base.toISOString().slice(0, 10);
};

async function openCustomBudgets(page: Page) {
  await loginAndWaitForDashboard(page);
  await page.goto("/orcamentos?modo=personalizado");
  await expect(page.getByRole("heading", { level: 1, name: "Orçamentos" })).toBeVisible();
}

async function createBudget(page: Page, name: string, start: string, end: string, limit: string) {
  await page.getByRole("button", { name: "Novo orçamento" }).first().click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(name);
  await dialog(page).getByLabel("Período", { exact: true }).selectOption("Personalizado");
  await dialog(page).getByLabel("Data inicial").fill(start);
  await dialog(page).getByLabel("Data final").fill(end);
  await dialog(page).getByLabel("Limite do período").fill(limit);
  await dialog(page).getByLabel("Categorias", { exact: true }).selectOption({ label: CATEGORY });
  await dialog(page).getByRole("button", { name: "Criar orçamento" }).click();
  await expect(dialog(page)).toBeHidden();
}

test("prepara a categoria e um gasto de marco pela API", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const category = await apiPost(request, headers, "/categories", { name: CATEGORY, kind: "expense", color: "#2563EB" });
  const account = await apiPost(request, headers, "/accounts", {
    name: "Conta Personalizado E2E",
    type: "asset",
    currency_code: "BRL",
    opening_balance: "9000.00",
    opening_balance_date: "2026-01-01",
  });
  await apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "withdrawal",
        date: "2026-03-10",
        description: "Passagem",
        amount: "300.00",
        currency_code: "BRL",
        account_id: account.id,
        counterparty_name: "Companhia",
        category_id: category.id,
      },
    ],
  });
});

test("um periodo que ja terminou vai para Expirados, com o gasto da categoria", async ({ page }) => {
  await openCustomBudgets(page);
  await createBudget(page, PAST, "2026-03-01", "2026-03-31", "1000,00");

  // Ja terminou: nao aparece em Ativos
  await expect(main(page).getByRole("heading", { level: 2, name: PAST })).toHaveCount(0);
  await page.getByRole("tab", { name: "Expirados" }).click();
  const item = card(page, PAST);
  await expect(item).toContainText("Expirado");
  await expect(item).toContainText("Personalizado");
  await expect(item).toContainText("R$ 300,00");
  await expect(item).toContainText("de R$ 1.000,00");
  await expect(item).toContainText("Restam R$ 700,00");
  await expect(item).toContainText(`Categorias: ${CATEGORY}`);
});

test("um periodo em curso fica em Ativos e comeca sem gasto", async ({ page }) => {
  await openCustomBudgets(page);
  await createBudget(page, CURRENT, today(-1), today(7), "500,00");

  const item = card(page, CURRENT);
  await expect(item).toContainText("R$ 0,00");
  await expect(item).toContainText("Restam R$ 500,00");
  await expect(item).not.toContainText("Expirado");
  await page.getByRole("tab", { name: "Expirados" }).click();
  await expect(main(page).getByRole("heading", { level: 2, name: CURRENT })).toHaveCount(0);
});

test("um gasto novo na categoria entra no orcamento em curso sem ligar nada", async ({ page, request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const categories = await (await request.get("/api/v1/categories", { headers })).json();
  const category = (categories.items ?? categories).find((item: { name: string }) => item.name === CATEGORY);
  const accounts = await (await request.get("/api/v1/accounts", { headers })).json();
  const account = (accounts.items ?? accounts).find((item: { name: string }) => item.name === "Conta Personalizado E2E");
  await apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "withdrawal",
        date: today(),
        description: "Hotel",
        amount: "120.00",
        currency_code: "BRL",
        account_id: account.id,
        counterparty_name: "Hotel E2E",
        category_id: category.id,
      },
    ],
  });
  await openCustomBudgets(page);
  await expect(card(page, CURRENT)).toContainText("R$ 120,00");
  await expect(card(page, CURRENT)).toContainText("Restam R$ 380,00");
});

test("liga o alerta editando o orcamento", async ({ page }) => {
  await openCustomBudgets(page);
  await page.getByRole("button", { name: `Ações do orçamento ${CURRENT}` }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await dialog(page).getByRole("switch", { name: "Receber alerta" }).click();
  await dialog(page).getByRole("button", { name: "Salvar" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(card(page, CURRENT)).toContainText("Com alerta");
});
