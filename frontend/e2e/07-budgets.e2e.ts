import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const NAME = "Mercado Orc E2E";
const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const card = (page: Page) => main(page).getByRole("heading", { level: 3, name: NAME }).locator("xpath=ancestor::li[1]");
const today = () => new Date().toLocaleDateString("sv-SE");

async function openBudgets(page: Page) {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Orçamentos" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Orçamentos" })).toBeVisible();
}

async function menu(page: Page, item: string) {
  await page.getByRole("button", { name: `Ações do orçamento ${NAME}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("sem orcamentos a pagina convida a criar o primeiro", async ({ page }) => {
  await openBudgets(page);
  await expect(page.getByText("Nenhum orçamento ainda")).toBeVisible();
});

test("cria um orcamento mensal e ele comeca sem gasto", async ({ page }) => {
  await openBudgets(page);
  await page.getByRole("button", { name: "Novo orçamento" }).first().click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(NAME);
  await dialog(page).getByLabel("Limite por período").fill("800,00");
  await dialog(page).getByRole("button", { name: "Criar orçamento" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page)).toContainText("Mensal");
  await expect(card(page)).toContainText("R$ 0,00");
  await expect(card(page)).toContainText("de R$ 800,00");
  await expect(card(page)).toContainText("Restam R$ 800,00");
  await expect(card(page).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
});

test("nome repetido e recusado no campo do nome", async ({ page }) => {
  await openBudgets(page);
  await page.getByRole("button", { name: "Novo orçamento" }).first().click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(NAME.toUpperCase());
  await dialog(page).getByLabel("Limite por período").fill("100");
  await dialog(page).getByRole("button", { name: "Criar orçamento" }).click();
  await expect(dialog(page).getByText("Já existe um orçamento com esse nome.")).toBeVisible();
});

test("o gasto dos lancamentos ligados aparece, com aviso perto do limite e depois ao estourar", async ({ page, request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const account = await apiPost(request, headers, "/accounts", {
    name: "Conta Orc E2E",
    type: "asset",
    currency_code: "BRL",
    opening_balance: "5000.00",
    opening_balance_date: "2026-01-01",
  });
  const budgets = await (await request.get("/api/v1/budgets", { headers })).json();
  const budgetId = budgets.items.find((item: { name: string }) => item.name === NAME).id;
  const spend = (amount: string, description: string) =>
    apiPost(request, headers, "/transactions", {
      splits: [
        {
          type: "withdrawal",
          date: today(),
          description,
          amount,
          currency_code: "BRL",
          account_id: account.id,
          counterparty_name: "Supermercado Orc",
          budget_id: budgetId,
        },
      ],
    });

  await spend("700.00", "Compra grande");
  await openBudgets(page);
  await expect(card(page)).toContainText("R$ 700,00");
  await expect(card(page)).toContainText("Perto do limite");
  await expect(card(page)).toContainText("Restam R$ 100,00");
  await expect(card(page).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "87");

  await spend("150.00", "Compra extra");
  // Abre a tela de novo: a sessao guardada restaura o login sozinha
  await openBudgets(page);
  await expect(card(page)).toContainText("Limite atingido");
  await expect(card(page)).toContainText("Passou R$ 50,00 do limite");
  await expect(card(page).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
});

test("editar o limite recalcula o restante", async ({ page }) => {
  await openBudgets(page);
  await menu(page, "Editar");
  await expect(dialog(page).getByLabel("Moeda")).toBeDisabled();
  await dialog(page).getByLabel("Limite por período").fill("2.000,00");
  await dialog(page).getByRole("button", { name: "Salvar" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page)).toContainText("de R$ 2.000,00");
  await expect(card(page)).toContainText("Restam R$ 1.150,00");
  await expect(card(page)).not.toContainText("Limite atingido");
});

test("meses sem gasto aparecem zerados e o botao Mes atual volta", async ({ page }) => {
  await openBudgets(page);
  await page.getByRole("button", { name: "Mês anterior" }).click();
  await expect(card(page)).toContainText("R$ 0,00");
  await expect(card(page)).toContainText("Restam R$ 2.000,00");
  await page.getByRole("button", { name: "Mês atual" }).click();
  await expect(card(page)).toContainText("R$ 850,00");
});

test("registrar uma saida pelo formulario escolhendo o orcamento faz o progresso subir", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await nav.getByRole("link", { name: "Transações" }).click();
  await page.getByRole("button", { name: "Novo lançamento" }).click();

  await dialog(page).getByLabel("Conta", { exact: true }).selectOption({ label: "Conta Orc E2E" });
  await dialog(page).getByLabel("Descrição", { exact: true }).fill("Feira pelo formulario");
  await dialog(page).getByLabel("Para quem", { exact: true }).fill("Feira Orc");
  await dialog(page).getByLabel("Valor (BRL)").fill("25,00");
  // O campo so mostra orcamentos ativos na moeda da conta escolhida
  await dialog(page).getByLabel("Orçamento", { exact: true }).selectOption({ label: NAME });
  await dialog(page).getByRole("button", { name: "Criar lançamento" }).click();
  await expect(dialog(page)).toBeHidden();

  await nav.getByRole("link", { name: "Orçamentos" }).click();
  await expect(card(page)).toContainText("R$ 875,00");
  await expect(card(page)).toContainText("Restam R$ 1.125,00");
});

test("arquivar esconde o orcamento; mostrar arquivados e restaurar traz de volta", async ({ page }) => {
  await openBudgets(page);
  await menu(page, "Arquivar");
  await expect(main(page).getByRole("heading", { level: 3, name: NAME })).toHaveCount(0);

  await page.getByLabel("Mostrar arquivados").check();
  await expect(card(page)).toContainText("Arquivado");
  await menu(page, "Restaurar");
  await page.getByLabel("Mostrar arquivados").uncheck();
  await expect(card(page)).not.toContainText("Arquivado");
});

test("excluir pede confirmacao; os lancamentos continuam, sem orcamento", async ({ page, request }) => {
  await openBudgets(page);
  await menu(page, "Excluir");
  await expect(dialog(page)).toContainText(NAME);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(card(page)).toBeVisible();

  await menu(page, "Excluir");
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByRole("heading", { level: 3, name: NAME })).toHaveCount(0);

  const headers = await apiHeaders(request, ADMIN);
  const list = await (await request.get("/api/v1/transactions", { headers, params: { q: "Compra grande" } })).json();
  expect(list.total).toBe(1);
  expect(list.items[0].splits[0].budget_id).toBeNull();
});
