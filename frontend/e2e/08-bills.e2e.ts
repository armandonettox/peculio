import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const NAME = "Netflix E2E";
const ACCOUNT = "Conta Bill E2E";
const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const card = (page: Page) => main(page).getByRole("heading", { level: 3, name: NAME }).locator("xpath=ancestor::li[1]");

const isoDaysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("sv-SE");
};
const brazilian = (iso: string) => iso.split("-").reverse().join("/");

// Primeiro vencimento tres dias atras: sem pagamento a conta esta atrasada, e pagar hoje quita esse vencimento
const FIRST_DUE = isoDaysFromToday(-3);

async function openBills(page: Page) {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Contas a pagar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contas a pagar" })).toBeVisible();
}

async function menu(page: Page, item: string) {
  await page.getByRole("button", { name: `Ações da conta a pagar ${NAME}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function registerExpense(page: Page, description: string, amount: string, bill?: string) {
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Transações" }).click();
  await page.getByRole("button", { name: "Novo lançamento" }).click();
  await dialog(page).getByLabel("Conta", { exact: true }).selectOption({ label: ACCOUNT });
  await dialog(page).getByLabel("Descrição", { exact: true }).fill(description);
  await dialog(page).getByLabel("Para quem", { exact: true }).fill("Streaming Bill");
  await dialog(page).getByLabel("Valor (BRL)").fill(amount);
  if (bill) await dialog(page).getByLabel("Conta a pagar", { exact: true }).selectOption({ label: bill });
  await dialog(page).getByRole("button", { name: "Criar lançamento" }).click();
  await expect(dialog(page)).toBeHidden();
}

test("prepara a conta bancaria pela API", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    currency_code: "BRL",
    opening_balance: "3000.00",
    opening_balance_date: "2026-01-01",
  });
});

test("sem contas a pagar a pagina convida a criar a primeira", async ({ page }) => {
  await openBills(page);
  await expect(page.getByText("Nenhuma conta a pagar ainda")).toBeVisible();
});

test("cria uma conta a pagar: sem pagamento, ela aparece como atrasada", async ({ page }) => {
  await openBills(page);
  await page.getByRole("button", { name: "Nova conta a pagar" }).first().click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(NAME);
  await dialog(page).getByLabel("Valor mínimo").fill("40,00");
  await dialog(page).getByLabel("Valor máximo").fill("60,00");
  await dialog(page).getByLabel("Texto para ligar sozinho").fill("netflix e2e");
  await dialog(page).getByLabel("Primeiro vencimento").fill(FIRST_DUE);
  await dialog(page).getByRole("button", { name: "Criar conta a pagar" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page)).toContainText("Mensal · R$ 40,00 a R$ 60,00");
  await expect(card(page)).toContainText(`Atrasada · venceu em ${brazilian(FIRST_DUE)}`);
  await expect(card(page)).toContainText("Liga sozinha quando contém “netflix e2e”");
});

test("nome repetido e recusado no campo do nome", async ({ page }) => {
  await openBills(page);
  await page.getByRole("button", { name: "Nova conta a pagar" }).first().click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(NAME.toUpperCase());
  await dialog(page).getByLabel("Valor mínimo").fill("10");
  await dialog(page).getByRole("button", { name: "Criar conta a pagar" }).click();
  await expect(dialog(page).getByText("Já existe uma conta a pagar com esse nome.")).toBeVisible();
});

test("um lancamento que combina liga sozinho e a conta passa a Pago", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await registerExpense(page, "Assinatura Netflix E2E", "50,00");

  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Contas a pagar" }).click();
  await expect(card(page)).toContainText("Pago");
  await expect(card(page)).not.toContainText("Atrasada");
});

test("escolher Nao ligar no formulario impede a ligacao automatica", async ({ page, request }) => {
  await loginAndWaitForDashboard(page);
  await registerExpense(page, "Netflix E2E de presente", "45,00", "Não ligar a nenhuma");

  const headers = await apiHeaders(request, ADMIN);
  const bills = await (await request.get("/api/v1/bills", { headers })).json();
  const billId = bills.items.find((item: { name: string }) => item.name === NAME).id;
  const linked = await (await request.get("/api/v1/transactions", { headers, params: { bill_id: billId } })).json();
  expect(linked.total).toBe(1);
  expect(linked.items[0].splits[0].description).toBe("Assinatura Netflix E2E");
});

test("editar a frequencia e o valor", async ({ page }) => {
  await openBills(page);
  await menu(page, "Editar");
  await expect(dialog(page).getByLabel("Moeda")).toBeDisabled();
  await dialog(page).getByLabel("Frequência").selectOption({ label: "Anual" });
  await dialog(page).getByLabel("Valor máximo").fill("80,00");
  await dialog(page).getByRole("button", { name: "Salvar" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page)).toContainText("Anual · R$ 40,00 a R$ 80,00");
});

test("arquivar esconde a conta; mostrar arquivadas e restaurar traz de volta", async ({ page }) => {
  await openBills(page);
  await menu(page, "Arquivar");
  await expect(main(page).getByRole("heading", { level: 3, name: NAME })).toHaveCount(0);

  await page.getByLabel("Mostrar arquivadas").check();
  await expect(card(page)).toContainText("Arquivada");
  await menu(page, "Restaurar");
  await page.getByLabel("Mostrar arquivadas").uncheck();
  await expect(card(page)).not.toContainText("Arquivada");
});

test("excluir pede confirmacao; os lancamentos continuam, sem conta a pagar", async ({ page, request }) => {
  await openBills(page);
  await menu(page, "Excluir");
  await expect(dialog(page)).toContainText(NAME);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(card(page)).toBeVisible();

  await menu(page, "Excluir");
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByRole("heading", { level: 3, name: NAME })).toHaveCount(0);

  const headers = await apiHeaders(request, ADMIN);
  const list = await (await request.get("/api/v1/transactions", { headers, params: { q: "Netflix E2E" } })).json();
  expect(list.total).toBe(2);
  for (const item of list.items) expect(item.splits[0].bill_id).toBeNull();
});
