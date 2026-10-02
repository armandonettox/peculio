import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const RULE = "Regra Padaria E2E";
const GROUP = "Casa Regras E2E";
const TOKEN = "padaria regra e2e";
const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const today = () => new Date().toLocaleDateString("sv-SE");

async function openRules(page: Page) {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Regras" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Regras" })).toBeVisible();
}

async function ruleMenu(page: Page, item: string) {
  await page.getByRole("button", { name: `Ações da regra ${RULE}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

// Dados que os passos seguintes reaproveitam
const state = { accountId: "", categoryId: "", oldTransactionId: "" };

async function spend(request: APIRequestContext, description: string, extra: Record<string, unknown> = {}) {
  const headers = await apiHeaders(request, ADMIN);
  const created = await apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "withdrawal",
        date: today(),
        description,
        amount: "25.00",
        currency_code: "BRL",
        account_id: state.accountId,
        counterparty_name: "Padaria Regras",
        ...extra,
      },
    ],
  });
  return created as { id: string; splits: { category_id: string | null }[] };
}

async function categoryOf(request: APIRequestContext, transactionId: string) {
  const headers = await apiHeaders(request, ADMIN);
  const response = await request.get(`/api/v1/transactions/${transactionId}`, { headers });
  return (await response.json()).splits[0].category_id as string | null;
}

test("sem regras a pagina convida a criar a primeira", async ({ page }) => {
  await openRules(page);
  await expect(page.getByText("Nenhuma regra ainda")).toBeVisible();
});

test("prepara os dados e cria um grupo", async ({ page, request }) => {
  const headers = await apiHeaders(request, ADMIN);
  state.accountId = (
    await apiPost(request, headers, "/accounts", {
      name: "Conta Regras E2E",
      type: "asset",
      currency_code: "BRL",
      opening_balance: "1000.00",
      opening_balance_date: "2026-01-01",
    })
  ).id;
  state.categoryId = (await apiPost(request, headers, "/categories", { name: "Padaria Regras" })).id;
  await apiPost(request, headers, "/categories", { name: "Outra Regras" });
  // Este lancamento nasce antes da regra: so a aplicacao nos antigos vai preenche-lo
  state.oldTransactionId = (await spend(request, "Pao da Padaria Regra E2E antigo")).id;

  await openRules(page);
  await page.getByRole("button", { name: "Novo grupo" }).click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(GROUP);
  await dialog(page).getByRole("button", { name: "Criar grupo" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByRole("heading", { level: 2, name: `${GROUP} (0)` })).toBeVisible();
});

test("cria a regra no grupo e o cartao mostra o resumo", async ({ page }) => {
  await openRules(page);
  await page.getByRole("button", { name: "Nova regra" }).first().click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(RULE);
  await dialog(page).getByLabel("Valor do gatilho 1").fill(TOKEN);
  await dialog(page).getByLabel("Alvo da ação 1").selectOption({ label: "Padaria Regras" });
  await dialog(page).getByLabel("Grupo", { exact: true }).selectOption({ label: GROUP });
  await dialog(page).getByRole("button", { name: "Criar regra" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByRole("heading", { level: 2, name: `${GROUP} (1)` })).toBeVisible();
  const card = main(page).getByRole("heading", { level: 3, name: RULE }).locator("xpath=ancestor::li[1]");
  await expect(card).toContainText(`Descrição contém "${TOKEN}"`);
  await expect(card).toContainText("Categoria: Padaria Regras");
});

test("nome repetido e recusado no campo do nome", async ({ page }) => {
  await openRules(page);
  await page.getByRole("button", { name: "Nova regra" }).first().click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(RULE.toUpperCase());
  await dialog(page).getByLabel("Valor do gatilho 1").fill("qualquer");
  await dialog(page).getByLabel("Alvo da ação 1").selectOption({ label: "Padaria Regras" });
  await dialog(page).getByRole("button", { name: "Criar regra" }).click();
  await expect(dialog(page).getByText("Já existe uma regra com esse nome.")).toBeVisible();
});

test("lancamento novo que combina recebe a categoria; o que ja tem categoria nao muda", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const other = await apiPost(request, headers, "/categories", { name: "Escolhida Regras" });

  const filled = await spend(request, "Compra na Padaria Regra E2E nova");
  expect(await categoryOf(request, filled.id)).toBe(state.categoryId);

  const chosen = await spend(request, "Outra Padaria Regra E2E", { category_id: other.id });
  expect(await categoryOf(request, chosen.id)).toBe(other.id);

  const unrelated = await spend(request, "Farmacia sem relacao");
  expect(await categoryOf(request, unrelated.id)).toBeNull();
});

test("aplicar nas antigas mostra a previa e so entao grava", async ({ page, request }) => {
  expect(await categoryOf(request, state.oldTransactionId)).toBeNull();

  await openRules(page);
  await page.getByRole("button", { name: "Aplicar nas antigas" }).click();
  await dialog(page).getByRole("button", { name: "Ver prévia" }).click();
  await expect(dialog(page).getByText(/^1 lançamento seria alterado de \d+\.$/)).toBeVisible();
  const preview = dialog(page).getByRole("region", { name: "Prévia" });
  await expect(preview).toContainText("Pao da Padaria Regra E2E antigo");
  await expect(preview).toContainText("Categoria: Padaria Regras");
  // So a previa: nada foi gravado
  expect(await categoryOf(request, state.oldTransactionId)).toBeNull();

  await dialog(page).getByRole("button", { name: "Aplicar em 1 lançamento" }).click();
  await expect(dialog(page).getByText("Pronto: 1 lançamento atualizado.")).toBeVisible();
  expect(await categoryOf(request, state.oldTransactionId)).toBe(state.categoryId);

  // Rodando de novo nao ha mais nada em branco
  await dialog(page).getByRole("button", { name: "Fechar" }).last().click();
  await page.getByRole("button", { name: "Aplicar nas antigas" }).click();
  await dialog(page).getByRole("button", { name: "Ver prévia" }).click();
  await expect(dialog(page).getByText(/^Nada para preencher em \d+ lançamentos\.$/)).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: /^Aplicar em/ })).toHaveCount(0);
});

test("regra pausada nao preenche mais", async ({ page, request }) => {
  await openRules(page);
  await ruleMenu(page, "Pausar");
  const card = main(page).getByRole("heading", { level: 3, name: RULE }).locator("xpath=ancestor::li[1]");
  await expect(card).toContainText("Pausada");

  const created = await spend(request, "Padaria Regra E2E com a regra pausada");
  expect(await categoryOf(request, created.id)).toBeNull();

  await ruleMenu(page, "Ativar");
  await expect(card).not.toContainText("Pausada");
});

test("exclui a regra e o grupo, cada um pedindo confirmacao", async ({ page }) => {
  await openRules(page);
  await ruleMenu(page, "Excluir");
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByRole("heading", { level: 3, name: RULE })).toHaveCount(0);
  await expect(main(page).getByRole("heading", { level: 2, name: `${GROUP} (0)` })).toBeVisible();

  await page.getByRole("button", { name: `Ações do grupo ${GROUP}` }).click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText("Nenhuma regra ainda")).toBeVisible();
});
