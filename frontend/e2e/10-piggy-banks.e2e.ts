import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const ACCOUNT = "Conta Cofre E2E";
const TRIP = "Viagem E2E";
const RESERVE = "Reserva E2E";
const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });
const card = (page: Page, name: string) =>
  main(page).getByRole("heading", { level: 3, name }).locator("xpath=ancestor::li[1]");

const isoDaysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("sv-SE");
};

async function openPiggyBanks(page: Page) {
  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Cofrinhos" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cofrinhos" })).toBeVisible();
}

async function action(page: Page, name: string, item: string) {
  await page.getByRole("button", { name: `Ações do cofrinho ${name}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function createPiggy(page: Page, name: string, target: string, date?: string) {
  await page.getByRole("button", { name: "Novo cofrinho" }).first().click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(name);
  await dialog(page).getByLabel("Conta", { exact: true }).selectOption({ label: ACCOUNT });
  await dialog(page).getByLabel(/^Valor da meta/).fill(target);
  if (date) await dialog(page).getByLabel("Data alvo (opcional)").fill(date);
  await dialog(page).getByRole("button", { name: "Criar cofrinho" }).click();
  await expect(dialog(page)).toBeHidden();
}

async function move(page: Page, name: string, item: "Guardar" | "Retirar", amount: string) {
  await action(page, name, item);
  await dialog(page).getByLabel(/^Valor/).fill(amount);
  await dialog(page).getByRole("button", { name: item }).click();
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

test("sem cofrinhos a pagina convida a criar o primeiro", async ({ page }) => {
  await openPiggyBanks(page);
  await expect(page.getByText("Nenhum cofrinho ainda")).toBeVisible();
});

test("cria um cofrinho com meta e data alvo, ainda sem nada guardado", async ({ page }) => {
  await openPiggyBanks(page);
  await createPiggy(page, TRIP, "600,00", isoDaysFromToday(200));

  await expect(card(page, TRIP)).toContainText(ACCOUNT);
  await expect(card(page, TRIP)).toContainText("R$ 0,00");
  await expect(card(page, TRIP)).toContainText("de R$ 600,00");
  await expect(card(page, TRIP)).toContainText("Faltam R$ 600,00");
  await expect(card(page, TRIP)).toContainText("por mês");
  await expect(card(page, TRIP)).toContainText(`Disponível em ${ACCOUNT}: R$ 1.000,00`);
});

test("guardar reserva o valor sem tirar dinheiro do saldo da conta", async ({ page }) => {
  await openPiggyBanks(page);
  await move(page, TRIP, "Guardar", "250,00");

  await expect(dialog(page)).toBeHidden();
  await expect(card(page, TRIP)).toContainText("R$ 250,00");
  await expect(card(page, TRIP)).toContainText("Faltam R$ 350,00");
  await expect(card(page, TRIP)).toContainText(`Disponível em ${ACCOUNT}: R$ 750,00`);
  await expect(card(page, TRIP).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "41");

  // O saldo da conta continua inteiro
  await nav(page).getByRole("link", { name: "Contas", exact: true }).click();
  const account = main(page).getByRole("heading", { level: 3, name: ACCOUNT }).locator("xpath=ancestor::li[1]");
  await expect(account).toContainText("R$ 1.000,00");
});

test("nao da para guardar mais do que esta disponivel", async ({ page }) => {
  await openPiggyBanks(page);
  await move(page, TRIP, "Guardar", "800,00");

  await expect(dialog(page).getByText(/A conta não tem esse valor disponível/)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(card(page, TRIP)).toContainText("R$ 250,00");
});

test("cofrinhos da mesma conta dividem o disponivel", async ({ page }) => {
  await openPiggyBanks(page);
  await createPiggy(page, RESERVE, "5.000,00");
  await expect(card(page, RESERVE)).toContainText(`Disponível em ${ACCOUNT}: R$ 750,00`);

  // O que ja esta guardado na Viagem nao pode ser reservado de novo
  await move(page, RESERVE, "Guardar", "750,01");
  await expect(dialog(page).getByText(/A conta não tem esse valor disponível/)).toBeVisible();
  await dialog(page).getByLabel(/^Valor/).fill("750,00");
  await dialog(page).getByRole("button", { name: "Guardar" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(card(page, RESERVE)).toContainText(`Disponível em ${ACCOUNT}: R$ 0,00`);
  await expect(card(page, TRIP)).toContainText(`Disponível em ${ACCOUNT}: R$ 0,00`);
});

test("retirar devolve o valor ao disponivel, e nao da para retirar mais do que ha", async ({ page }) => {
  await openPiggyBanks(page);
  await move(page, TRIP, "Retirar", "300,00");
  await expect(dialog(page).getByText("O cofrinho não tem esse valor guardado.")).toBeVisible();

  await dialog(page).getByLabel(/^Valor/).fill("50,00");
  await dialog(page).getByRole("button", { name: "Retirar" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(card(page, TRIP)).toContainText("R$ 200,00");
  await expect(card(page, TRIP)).toContainText(`Disponível em ${ACCOUNT}: R$ 50,00`);
});

test("o historico mostra os movimentos do mais recente para o mais antigo", async ({ page }) => {
  await openPiggyBanks(page);
  await action(page, TRIP, "Histórico");

  const rows = dialog(page).getByRole("list", { name: "Movimentos" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Retirou");
  await expect(rows.nth(0)).toContainText("R$ 50,00");
  await expect(rows.nth(1)).toContainText("Guardou");
  await expect(rows.nth(1)).toContainText("R$ 250,00");
});

test("editar muda a meta; a conta fica travada", async ({ page }) => {
  await openPiggyBanks(page);
  await action(page, TRIP, "Editar");
  await expect(dialog(page).getByLabel("Conta", { exact: true })).toBeDisabled();
  await dialog(page).getByLabel(/^Valor da meta/).fill("400,00");
  await dialog(page).getByRole("button", { name: "Salvar" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page, TRIP)).toContainText("de R$ 400,00");
  await expect(card(page, TRIP)).toContainText("Faltam R$ 200,00");
});

test("excluir pede confirmacao e libera o valor guardado na conta", async ({ page }) => {
  await openPiggyBanks(page);
  await action(page, TRIP, "Excluir");
  await expect(dialog(page)).toContainText(TRIP);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(card(page, TRIP)).toBeVisible();

  await action(page, TRIP, "Excluir");
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByRole("heading", { level: 3, name: TRIP })).toHaveCount(0);
  // Os 200 que estavam guardados voltam a ficar disponiveis: 50 + 200
  await expect(card(page, RESERVE)).toContainText(`Disponível em ${ACCOUNT}: R$ 250,00`);
});
