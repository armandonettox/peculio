import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard, setDefaultCurrency } from "./helpers";

// Filtro de Situacoes da tela de Transacoes, igual ao do Mobills: Efetuadas, Pendentes, Movimentacoes fixas e Ignoradas,
// uma por vez. Os lancamentos tem um texto proprio na descricao e a busca (?busca=) separa os deste spec dos de outros.
test.describe.configure({ mode: "serial" });

const TAG = "Sit E2E";
const PAID = `Paga ${TAG}`;
const PENDING = `Pendente ${TAG}`;
const IGNORED = `Ignorada ${TAG}`;
const FIXED = `Fixa ${TAG}`;
const REPEATED = `Repete ${TAG}`;
const ACCOUNT = "Conta Situacao E2E";

// O app usa o "hoje" do servidor (America/Sao_Paulo): o executor pode estar em outro fuso
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

const main = (page: Page) => page.getByRole("main");
const shows = (page: Page, text: string) => main(page).getByText(text, { exact: true });

async function openFilteredList(page: Page) {
  await loginAndWaitForDashboard(page);
  await page.goto(`/transacoes?busca=${encodeURIComponent(TAG)}`);
  await expect(shows(page, PAID)).toBeVisible();
}

async function chooseStatus(page: Page, label: string) {
  await page.getByLabel("Situação", { exact: true }).selectOption({ label });
}

test("prepara um lancamento de cada situacao pela API", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  await setDefaultCurrency(request, headers, "BRL");
  const account = await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    currency_code: "BRL",
    opening_balance: "5000.00",
    opening_balance_date: "2026-01-01",
  });
  const split = (description: string, amount: string, extra: Record<string, unknown> = {}) => ({
    type: "withdrawal",
    date: today(),
    description,
    amount,
    currency_code: "BRL",
    account_id: account.id,
    counterparty_name: "Loja Situacao",
    ...extra,
  });
  await apiPost(request, headers, "/transactions", { splits: [split(PAID, "11.00")] });
  await apiPost(request, headers, "/transactions", { splits: [split(PENDING, "22.00", { is_paid: false })] });
  await apiPost(request, headers, "/transactions", { splits: [split(IGNORED, "5.00", { ignored: true })] });
  // Despesa fixa: recorrencia sem fim. "Repetir": a mesma recorrencia com numero de vezes, que nao e fixa.
  const recurrence = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    frequency: "monthly",
    first_date: today(),
    auto_create: true,
    template: { splits: [split(name, "13.00")] },
    ...extra,
  });
  await apiPost(request, headers, "/recurrences", recurrence(FIXED));
  await apiPost(request, headers, "/recurrences", recurrence(REPEATED, { max_occurrences: 2 }));
});

test("sem situacao a lista mostra todos, e o filtro comeca em Todas as situacoes", async ({ page }) => {
  await openFilteredList(page);
  for (const text of [PAID, PENDING, IGNORED, FIXED, REPEATED]) await expect(shows(page, text)).toBeVisible();

  await page.getByRole("button", { name: /^Filtros/ }).click();
  const field = page.getByLabel("Situação", { exact: true });
  await expect(field).toHaveValue("");
  await expect(field.locator("option")).toHaveText([
    "Todas as situações",
    "Efetuadas",
    "Pendentes",
    "Movimentações fixas",
    "Ignoradas",
  ]);
});

test("Pendentes mostra so o que ainda nao foi pago", async ({ page }) => {
  await openFilteredList(page);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await chooseStatus(page, "Pendentes");

  await expect(shows(page, PENDING)).toBeVisible();
  for (const text of [PAID, IGNORED, FIXED, REPEATED]) await expect(shows(page, text)).toHaveCount(0);
  await expect(page).toHaveURL(/situacao=pending/);
});

test("Efetuadas mostra os pagos, inclusive o ignorado que esta pago, como no Mobills", async ({ page }) => {
  await openFilteredList(page);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await chooseStatus(page, "Efetuadas");

  for (const text of [PAID, IGNORED, FIXED, REPEATED]) await expect(shows(page, text)).toBeVisible();
  await expect(shows(page, PENDING)).toHaveCount(0);
});

test("Ignoradas mostra so as ignoradas", async ({ page }) => {
  await openFilteredList(page);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await chooseStatus(page, "Ignoradas");

  await expect(shows(page, IGNORED)).toBeVisible();
  for (const text of [PAID, PENDING, FIXED, REPEATED]) await expect(shows(page, text)).toHaveCount(0);
});

test("Movimentacoes fixas mostra a despesa fixa e nao a repetida", async ({ page }) => {
  await openFilteredList(page);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await chooseStatus(page, "Movimentações fixas");

  await expect(shows(page, FIXED)).toBeVisible();
  for (const text of [PAID, PENDING, IGNORED, REPEATED]) await expect(shows(page, text)).toHaveCount(0);
});

test("com uma situacao escolhida o Patrimonio liquido some dos cartoes e voltar a Todas traz de volta", async ({ page }) => {
  await openFilteredList(page);
  await expect(main(page).getByText("Patrimônio líquido")).toBeVisible();

  await page.getByRole("button", { name: /^Filtros/ }).click();
  await chooseStatus(page, "Pendentes");
  await expect(shows(page, PENDING)).toBeVisible();
  await expect(main(page).getByText("Patrimônio líquido")).toHaveCount(0);
  await expect(main(page).getByText("Despesas", { exact: true })).toBeVisible();

  await chooseStatus(page, "Todas as situações");
  await expect(shows(page, PAID)).toBeVisible();
  await expect(main(page).getByText("Patrimônio líquido")).toBeVisible();
  await expect(page).not.toHaveURL(/situacao/);
});

test("o link com a situacao abre a lista ja filtrada", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.goto(`/transacoes?busca=${encodeURIComponent(TAG)}&situacao=fixed`);
  await expect(shows(page, FIXED)).toBeVisible();
  await expect(shows(page, PAID)).toHaveCount(0);
  await expect(page.getByLabel("Situação", { exact: true })).toHaveValue("fixed");
});
