import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const NAME = "Netflix E2E";
const ACCOUNT = "Conta Bill E2E";
const REC_ACCOUNT = "Conta Rec E2E";
const DAILY = "Assinatura diaria E2E";
const LIMITED = "Parcelas E2E";
const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const card = (page: Page, name: string = NAME) =>
  main(page).getByRole("heading", { level: 2, name }).locator("xpath=ancestor::li[1]");
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });

// O app usa o "hoje" do servidor (APP_TIMEZONE, America/Sao_Paulo); calcular aqui com o fuso do
// executor (UTC na CI) desalinharia perto da virada do dia em Brasilia
const isoDaysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
};
const brazilian = (iso: string) => iso.split("-").reverse().join("/");

// Primeiro vencimento tres dias atras: sem pagamento o lembrete esta atrasado, e pagar hoje quita esse vencimento
const FIRST_DUE = isoDaysFromToday(-3);

// Contas a pagar e Recorrentes viraram uma lista so: nao ha mais abas
async function openRecurrences(page: Page) {
  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Recorrentes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Recorrentes" })).toBeVisible();
}

async function menu(page: Page, name: string, item: string) {
  await page.getByRole("button", { name: `Ações da recorrente ${name}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function registerExpense(page: Page, description: string, amount: string, bill?: string) {
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Transações" }).click();
  await page.getByRole("button", { name: "Novo lançamento" }).first().click();
  await dialog(page).getByLabel("Conta", { exact: true }).selectOption({ label: ACCOUNT });
  await dialog(page).getByLabel("Descrição", { exact: true }).fill(description);
  await dialog(page).getByLabel("Para quem", { exact: true }).fill("Streaming Bill");
  await dialog(page).getByLabel("Valor (BRL)").fill(amount);
  if (bill) await dialog(page).getByLabel("Conta a pagar", { exact: true }).selectOption({ label: bill });
  await dialog(page).getByRole("button", { name: "Criar lançamento" }).click();
  await expect(dialog(page)).toBeHidden();
}

async function balanceOf(page: Page, account: string) {
  await nav(page).getByRole("link", { name: "Contas", exact: true }).click();
  return main(page).getByRole("heading", { level: 3, name: account }).locator("xpath=ancestor::li[1]");
}

async function fillRecurrence(
  page: Page,
  { name, description, firstDate, amount }: { name: string; description: string; firstDate: string; amount: string },
) {
  await dialog(page).getByLabel("Nome da recorrente").fill(name);
  await dialog(page).getByLabel("Conta", { exact: true }).selectOption({ label: REC_ACCOUNT });
  await dialog(page).getByLabel("Descrição", { exact: true }).fill(description);
  await dialog(page).getByLabel("Para quem", { exact: true }).fill("Servico Rec E2E");
  await dialog(page).getByLabel("Valor (BRL)").fill(amount);
  await dialog(page).getByLabel("Primeira data").fill(firstDate);
}

test("prepara as contas bancarias pela API", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    currency_code: "BRL",
    opening_balance: "3000.00",
    opening_balance_date: "2026-01-01",
  });
  await apiPost(request, headers, "/accounts", {
    name: REC_ACCOUNT,
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

// ---------- Modo de lembrete (nao cria o lancamento sozinho) ----------

test("cria um lembrete: sem pagamento, ele aparece como atrasado", async ({ page }) => {
  await openRecurrences(page);
  await page.getByRole("button", { name: "Nova recorrente", exact: true }).first().click();
  await page.getByRole("button", { name: /Não, o valor varia/ }).click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(NAME);
  await dialog(page).getByLabel("Valor mínimo").fill("40,00");
  await dialog(page).getByLabel("Valor máximo").fill("60,00");
  await dialog(page).getByLabel("Texto para ligar sozinho").fill("netflix e2e");
  await dialog(page).getByLabel("Primeiro vencimento").fill(FIRST_DUE);
  await dialog(page).getByRole("button", { name: "Criar lembrete" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page)).toContainText("Mensal · R$ 40,00 a R$ 60,00");
  await expect(card(page)).toContainText(`Atrasada · venceu em ${brazilian(FIRST_DUE)}`);
  await expect(card(page)).toContainText("Liga sozinha quando contém “netflix e2e”");
});

test("nome repetido e recusado no campo do nome", async ({ page }) => {
  await openRecurrences(page);
  await page.getByRole("button", { name: "Nova recorrente", exact: true }).first().click();
  await page.getByRole("button", { name: /Não, o valor varia/ }).click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(NAME.toUpperCase());
  await dialog(page).getByLabel("Valor mínimo").fill("10");
  await dialog(page).getByRole("button", { name: "Criar lembrete" }).click();
  await expect(dialog(page).getByText("Já existe uma recorrente com esse nome.")).toBeVisible();
});

test("um lancamento que combina liga sozinho e o lembrete passa a Pago", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await registerExpense(page, "Assinatura Netflix E2E", "50,00");

  await openRecurrences(page);
  await expect(card(page)).toContainText("Pago");
  await expect(card(page)).not.toContainText("Atrasada");
});

test("escolher Nao ligar no formulario impede a ligacao automatica", async ({ page, request }) => {
  await loginAndWaitForDashboard(page);
  await registerExpense(page, "Netflix E2E de presente", "45,00", "Não ligar a nenhuma");

  const headers = await apiHeaders(request, ADMIN);
  const recurrences = await (await request.get("/api/v1/recurrences", { headers })).json();
  const billId = recurrences.items.find((item: { name: string }) => item.name === NAME).id;
  const linked = await (await request.get("/api/v1/transactions", { headers, params: { bill_id: billId } })).json();
  expect(linked.total).toBe(1);
  expect(linked.items[0].splits[0].description).toBe("Assinatura Netflix E2E");
});

test("editar a frequencia e o valor do lembrete", async ({ page }) => {
  await openRecurrences(page);
  await menu(page, NAME, "Editar");
  await expect(dialog(page).getByLabel("Moeda")).toBeDisabled();
  await dialog(page).getByLabel("Frequência").selectOption({ label: "Anual" });
  await dialog(page).getByLabel("Valor máximo").fill("80,00");
  await dialog(page).getByRole("button", { name: "Salvar" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page)).toContainText("Anual · R$ 40,00 a R$ 80,00");
});

test("arquivar esconde o lembrete; mostrar inativas e restaurar traz de volta", async ({ page }) => {
  await openRecurrences(page);
  await menu(page, NAME, "Arquivar");
  await expect(main(page).getByRole("heading", { level: 2, name: NAME })).toHaveCount(0);

  await page.getByLabel("Mostrar inativas").check();
  await expect(card(page)).toContainText("Arquivada");
  await menu(page, NAME, "Restaurar");
  await page.getByLabel("Mostrar inativas").uncheck();
  await expect(card(page)).not.toContainText("Arquivada");
});

test("excluir o lembrete pede confirmacao; os lancamentos continuam, sem ligacao", async ({ page, request }) => {
  await openRecurrences(page);
  await menu(page, NAME, "Excluir");
  await expect(dialog(page)).toContainText(NAME);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(card(page)).toBeVisible();

  await menu(page, NAME, "Excluir");
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByRole("heading", { level: 2, name: NAME })).toHaveCount(0);

  const headers = await apiHeaders(request, ADMIN);
  const list = await (await request.get("/api/v1/transactions", { headers, params: { q: "Netflix E2E" } })).json();
  expect(list.total).toBe(2);
  for (const item of list.items) expect(item.splits[0].bill_id).toBeNull();
});

// ---------- Modo automatico (cria o lancamento sozinho) ----------

test("uma diaria que comecou ha dois dias cria os tres lancamentos e baixa o saldo", async ({ page }) => {
  await openRecurrences(page);
  await page.getByRole("button", { name: "Nova recorrente", exact: true }).first().click();
  await page.getByRole("button", { name: /Sim, valor fixo/ }).click();
  await fillRecurrence(page, { name: DAILY, description: "Assinatura diaria", firstDate: isoDaysFromToday(-2), amount: "10,00" });
  await dialog(page).getByLabel("Frequência").selectOption({ label: "Diária" });
  await expect(dialog(page).getByText(/Os lançamentos desde esta data até hoje serão criados agora/)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Criar recorrente" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page, DAILY)).toContainText("Diária · Assinatura diaria · R$ 10,00");
  await expect(card(page, DAILY)).toContainText("3 criadas");
  await expect(card(page, DAILY)).toContainText("Próximo: ");

  const accountCard = await balanceOf(page, REC_ACCOUNT);
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
  await page.getByRole("button", { name: "Nova recorrente", exact: true }).first().click();
  await page.getByRole("button", { name: /Sim, valor fixo/ }).click();
  await fillRecurrence(page, { name: LIMITED, description: "Parcela", firstDate: isoDaysFromToday(-5), amount: "5,00" });
  await dialog(page).getByLabel("Frequência").selectOption({ label: "Diária" });
  await dialog(page).getByLabel("Termina").selectOption({ label: "Depois de N vezes" });
  await dialog(page).getByLabel("Quantas vezes").fill("2");
  await dialog(page).getByRole("button", { name: "Criar recorrente" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(card(page, LIMITED)).toContainText("2 vezes (2 criadas)");
  await expect(card(page, LIMITED)).toContainText("Terminou");
  const accountCard = await balanceOf(page, REC_ACCOUNT);
  // 970 - 2 x 5
  await expect(accountCard).toContainText("R$ 960,00");
});

test("nome vazio e data final antes da primeira sao recusados", async ({ page }) => {
  await openRecurrences(page);
  await page.getByRole("button", { name: "Nova recorrente", exact: true }).first().click();
  await page.getByRole("button", { name: /Sim, valor fixo/ }).click();
  await dialog(page).getByRole("button", { name: "Criar recorrente" }).click();
  await expect(dialog(page).getByText("Informe o nome da recorrente.")).toBeVisible();

  await fillRecurrence(page, { name: "X", description: "x", firstDate: isoDaysFromToday(10), amount: "1,00" });
  await dialog(page).getByLabel("Termina").selectOption({ label: "Numa data" });
  await dialog(page).getByLabel("Data final").fill(isoDaysFromToday(1));
  await dialog(page).getByRole("button", { name: "Criar recorrente" }).click();
  await expect(dialog(page).getByText("A data final não pode ser antes da primeira.")).toBeVisible();
});

test("pausar esconde a recorrente; mostrar inativas e retomar traz de volta", async ({ page }) => {
  await openRecurrences(page);
  await menu(page, DAILY, "Pausar");
  await expect(main(page).getByRole("heading", { level: 2, name: DAILY })).toHaveCount(0);

  await page.getByLabel("Mostrar inativas").check();
  await expect(card(page, DAILY)).toContainText("Pausada");
  await menu(page, DAILY, "Retomar");
  await page.getByLabel("Mostrar inativas").uncheck();
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
  const accountCard = await balanceOf(page, REC_ACCOUNT);
  await expect(accountCard).toContainText("R$ 960,00");
});

test("excluir a recorrente automatica pede confirmacao; os lancamentos ja criados continuam", async ({ page, request }) => {
  await openRecurrences(page);
  await menu(page, DAILY, "Excluir");
  await expect(dialog(page)).toContainText(DAILY);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(card(page, DAILY)).toBeVisible();

  await menu(page, DAILY, "Excluir");
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByRole("heading", { level: 2, name: DAILY })).toHaveCount(0);

  const headers = await apiHeaders(request, ADMIN);
  const list = await (await request.get("/api/v1/transactions", { headers, params: { q: "Assinatura diaria" } })).json();
  expect(list.total).toBe(3);
  for (const item of list.items) expect(item.recurrence_id).toBeNull();
});
