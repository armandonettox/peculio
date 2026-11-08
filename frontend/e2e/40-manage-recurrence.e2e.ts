import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard, setDefaultCurrency } from "./helpers";

// Gestao de recorrencia pela tela de Transacoes: o menu da linha de um lancamento que veio de uma recorrencia abre o
// resumo da serie, com editar, pausar ou retomar e excluir. Antes isso ficava so na pagina Recorrentes.
test.describe.configure({ mode: "serial" });

const NAME = "Gestao Rec E2E";
const PLAIN = "Comum Gestao Rec E2E";
const ACCOUNT = "Conta Gestao Rec E2E";

// O app usa o "hoje" do servidor (America/Sao_Paulo): o executor pode estar em outro fuso
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");

async function openList(page: Page) {
  await loginAndWaitForDashboard(page);
  await page.goto(`/transacoes?busca=${encodeURIComponent("Gestao Rec E2E")}`);
  await expect(main(page).getByText(NAME, { exact: true })).toBeVisible();
}

async function openManage(page: Page) {
  await page.getByRole("button", { name: `Ações do lançamento ${NAME}` }).click();
  await page.getByRole("menuitem", { name: "Gerenciar recorrência" }).click();
  await expect(dialog(page).getByRole("heading", { name: NAME })).toBeVisible();
}

test("prepara uma recorrencia automatica e um lancamento comum pela API", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  await setDefaultCurrency(request, headers, "BRL");
  const account = await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    currency_code: "BRL",
    opening_balance: "5000.00",
    opening_balance_date: "2026-01-01",
  });
  const split = (description: string) => ({
    type: "withdrawal",
    date: today(),
    description,
    amount: "30.00",
    currency_code: "BRL",
    account_id: account.id,
    counterparty_name: "Locador Gestao",
  });
  await apiPost(request, headers, "/transactions", { splits: [split(PLAIN)] });
  // Cria o lancamento de hoje na hora
  await apiPost(request, headers, "/recurrences", {
    name: NAME,
    frequency: "monthly",
    first_date: today(),
    auto_create: true,
    template: { splits: [split(NAME)] },
  });
});

test("so o lancamento que veio da recorrencia tem Gerenciar recorrencia no menu", async ({ page }) => {
  await openList(page);
  await page.getByRole("button", { name: `Ações do lançamento ${PLAIN}` }).click();
  await expect(page.getByRole("menuitem", { name: "Editar" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Gerenciar recorrência" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: `Ações do lançamento ${NAME}` }).click();
  await expect(page.getByRole("menuitem", { name: "Gerenciar recorrência" })).toBeVisible();
});

test("o resumo mostra a frequencia e o proximo lancamento", async ({ page }) => {
  await openList(page);
  await openManage(page);
  await expect(dialog(page).getByText("Automática")).toBeVisible();
  await expect(dialog(page)).toContainText("Mensal");
  await expect(dialog(page)).toContainText("Próximo");
  await expect(dialog(page).getByRole("button", { name: "Pausar" })).toBeVisible();
});

test("pausar e retomar a recorrencia", async ({ page }) => {
  await openList(page);
  await openManage(page);
  await dialog(page).getByRole("button", { name: "Pausar" }).click();
  await expect(dialog(page).getByRole("button", { name: "Retomar" })).toBeVisible();
  await expect(dialog(page).getByText("Pausada").first()).toBeVisible();

  // Fica salvo no servidor: abre de novo e continua pausada
  await page.reload();
  await openManage(page);
  await expect(dialog(page).getByRole("button", { name: "Retomar" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Retomar" }).click();
  await expect(dialog(page).getByRole("button", { name: "Pausar" })).toBeVisible();
});

test("Editar abre o formulario da recorrencia", async ({ page }) => {
  await openList(page);
  await openManage(page);
  await dialog(page).getByRole("button", { name: "Editar" }).click();
  await expect(page.getByRole("dialog", { name: "Editar recorrente" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
});

test("cancelar a exclusao volta ao resumo e excluir apaga a serie, mantendo o lancamento que ja foi criado", async ({
  page,
  request,
}) => {
  await openList(page);
  await openManage(page);
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await page.getByRole("dialog", { name: "Excluir recorrente" }).getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog(page).getByRole("heading", { name: NAME })).toBeVisible();

  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await page.getByRole("dialog", { name: "Excluir recorrente" }).getByRole("button", { name: "Excluir" }).click();
  await expect(dialog(page)).toBeHidden();

  // O lancamento que a recorrencia ja tinha criado continua na lista, mas sem o menu de recorrencia
  await expect(main(page).getByText(NAME, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Ações do lançamento ${NAME}` }).click();
  await expect(page.getByRole("menuitem", { name: "Editar" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Gerenciar recorrência" })).toHaveCount(0);

  const headers = await apiHeaders(request, ADMIN);
  const list = await (await request.get("/api/v1/recurrences", { headers })).json();
  expect(list.items.some((item: { name: string }) => item.name === NAME)).toBe(false);
});
