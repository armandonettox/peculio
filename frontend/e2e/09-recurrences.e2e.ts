import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const ACCOUNT = "Conta Rec E2E";
const DAILY = "Assinatura diaria E2E";
const LIMITED = "Parcelas E2E";
const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const card = (page: Page, name: string) =>
  main(page).getByRole("heading", { level: 3, name }).locator("xpath=ancestor::li[1]");
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });

const isoDaysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("sv-SE");
};

async function openRecurrences(page: Page) {
  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Recorrentes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Recorrentes" })).toBeVisible();
}

async function menu(page: Page, name: string, item: string) {
  await page.getByRole("button", { name: `Ações da recorrente ${name}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function balanceOf(page: Page, account: string) {
  await nav(page).getByRole("link", { name: "Contas", exact: true }).click();
  const item = main(page).getByRole("heading", { level: 3, name: account }).locator("xpath=ancestor::li[1]");
  return item;
}

async function fillRecurrence(
  page: Page,
  { name, description, firstDate, amount }: { name: string; description: string; firstDate: string; amount: string },
) {
  await dialog(page).getByLabel("Nome da recorrente").fill(name);
  await dialog(page).getByLabel("Conta", { exact: true }).selectOption({ label: ACCOUNT });
  await dialog(page).getByLabel("Descrição", { exact: true }).fill(description);
  await dialog(page).getByLabel("Para quem", { exact: true }).fill("Servico Rec E2E");
  await dialog(page).getByLabel("Valor (BRL)").fill(amount);
  await dialog(page).getByLabel("Primeira data").fill(firstDate);
}

test("prepara a conta pela API", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    currency_code: "BRL",
    opening_balance: "1000.00",
    opening_balance_date: "2026-01-01",
  });
});

test("sem recorrentes a pagina convida a criar a primeira", async ({ page }) => {
  await openRecurrences(page);
  await expect(page.getByText("Nenhuma recorrente ainda")).toBeVisible();
});

test("uma diaria que comecou ha dois dias cria os tres lancamentos e baixa o saldo", async ({ page }) => {
  await openRecurrences(page);
  await page.getByRole("button", { name: "Nova recorrente" }).first().click();
  await fillRecurrence(page, { name: DAILY, description: "Assinatura diaria", firstDate: isoDaysFromToday(-2), amount: "10,00" });
  await dialog(page).getByLabel("Frequência").selectOption({ label: "Diária" });
  await expect(dialog(page).getByText(/Os lançamentos desde esta data até hoje serão criados agora/)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Criar recorrente" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page, DAILY)).toContainText("Diária · Assinatura diaria · R$ 10,00");
  await expect(card(page, DAILY)).toContainText("3 criadas");
  await expect(card(page, DAILY)).toContainText("Próximo: ");

  const accountCard = await balanceOf(page, ACCOUNT);
  await expect(accountCard).toContainText("R$ 970,00");
});

test("os lancamentos criados aparecem nas transacoes, um por dia, com as datas certas", async ({ page, request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const list = await (await request.get("/api/v1/transactions", { headers, params: { q: "Assinatura diaria" } })).json();
  expect(list.total).toBe(3);
  const dates = list.items.map((item: { splits: { date: string }[] }) => item.splits[0].date).sort();
  expect(dates).toEqual([isoDaysFromToday(-2), isoDaysFromToday(-1), isoDaysFromToday(0)]);

  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Transações" }).click();
  await expect(main(page).getByText("Assinatura diaria", { exact: true })).toHaveCount(3);
});

test("com fim por quantidade ela termina sozinha depois de criar o numero pedido", async ({ page }) => {
  await openRecurrences(page);
  await page.getByRole("button", { name: "Nova recorrente" }).first().click();
  await fillRecurrence(page, { name: LIMITED, description: "Parcela", firstDate: isoDaysFromToday(-5), amount: "5,00" });
  await dialog(page).getByLabel("Frequência").selectOption({ label: "Diária" });
  await dialog(page).getByLabel("Termina").selectOption({ label: "Depois de N vezes" });
  await dialog(page).getByLabel("Quantas vezes").fill("2");
  await dialog(page).getByRole("button", { name: "Criar recorrente" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page, LIMITED)).toContainText("2 vezes (2 criadas)");
  await expect(card(page, LIMITED)).toContainText("Terminou");
  const accountCard = await balanceOf(page, ACCOUNT);
  // 970 - 2 x 5
  await expect(accountCard).toContainText("R$ 960,00");
});

test("nome vazio e data final antes da primeira sao recusados", async ({ page }) => {
  await openRecurrences(page);
  await page.getByRole("button", { name: "Nova recorrente" }).first().click();
  await dialog(page).getByRole("button", { name: "Criar recorrente" }).click();
  await expect(dialog(page).getByText("Informe o nome da recorrente.")).toBeVisible();

  await fillRecurrence(page, { name: "X", description: "x", firstDate: isoDaysFromToday(10), amount: "1,00" });
  await dialog(page).getByLabel("Termina").selectOption({ label: "Numa data" });
  await dialog(page).getByLabel("Data final").fill(isoDaysFromToday(1));
  await dialog(page).getByRole("button", { name: "Criar recorrente" }).click();
  await expect(dialog(page).getByText("A data final não pode ser antes da primeira.")).toBeVisible();
});

test("pausar esconde a recorrente; mostrar pausadas e retomar traz de volta", async ({ page }) => {
  await openRecurrences(page);
  await menu(page, DAILY, "Pausar");
  await expect(main(page).getByRole("heading", { level: 3, name: DAILY })).toHaveCount(0);

  await page.getByLabel("Mostrar pausadas").check();
  await expect(card(page, DAILY)).toContainText("Pausada");
  await menu(page, DAILY, "Retomar");
  await page.getByLabel("Mostrar pausadas").uncheck();
  await expect(card(page, DAILY)).not.toContainText("Pausada");
});

test("editar muda o valor dos proximos lancamentos; frequencia e primeira data ficam travadas", async ({ page }) => {
  await openRecurrences(page);
  await menu(page, DAILY, "Editar");
  await expect(dialog(page).getByLabel("Frequência")).toBeDisabled();
  await expect(dialog(page).getByLabel("Primeira data")).toBeDisabled();
  await dialog(page).getByLabel("Valor (BRL)").fill("20,00");
  await dialog(page).getByRole("button", { name: "Salvar" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page, DAILY)).toContainText("Assinatura diaria · R$ 20,00");
  // Os tres ja criados continuam em R$ 10,00: o saldo nao mudou
  const accountCard = await balanceOf(page, ACCOUNT);
  await expect(accountCard).toContainText("R$ 960,00");
});

test("excluir pede confirmacao; os lancamentos ja criados continuam", async ({ page, request }) => {
  await openRecurrences(page);
  await menu(page, DAILY, "Excluir");
  await expect(dialog(page)).toContainText(DAILY);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(card(page, DAILY)).toBeVisible();

  await menu(page, DAILY, "Excluir");
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByRole("heading", { level: 3, name: DAILY })).toHaveCount(0);

  const headers = await apiHeaders(request, ADMIN);
  const list = await (await request.get("/api/v1/transactions", { headers, params: { q: "Assinatura diaria" } })).json();
  expect(list.total).toBe(3);
  for (const item of list.items) expect(item.recurrence_id).toBeNull();
});
