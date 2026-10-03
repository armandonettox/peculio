import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// O "hoje" do app e o do servidor, nao o do aparelho. Aqui o relogio do navegador fica em 2020 e o app
// precisa continuar no dia certo. Roda depois do 01 (que cria o administrador).
test.describe.configure({ mode: "serial" });

const WRONG_DEVICE_TIME = new Date("2020-01-15T12:00:00Z");

async function serverToday(request: APIRequestContext): Promise<string> {
  const headers = await apiHeaders(request, ADMIN);
  const response = await request.get("/api/v1/clock", { headers });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.timezone).toBeTruthy();
  return body.today;
}

async function openWithWrongDeviceClock(page: Page) {
  await page.clock.install({ time: WRONG_DEVICE_TIME });
  await loginAndWaitForDashboard(page);
  // Prova que o relogio do navegador esta mesmo errado
  expect(await page.evaluate(() => new Date().getFullYear())).toBe(2020);
}

test("o servidor informa o relogio do app: instante em UTC, fuso e o dia", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const body = await (await request.get("/api/v1/clock", { headers })).json();
  expect(Math.abs(Date.now() - Date.parse(body.now))).toBeLessThan(60_000);
  expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const unauthenticated = await request.get("/api/v1/clock");
  expect(unauthenticated.status()).toBe(401);
});

test("com o relogio do aparelho em 2020, a data padrao do lancamento novo e a de hoje no servidor", async ({ page, request }) => {
  const today = await serverToday(request);
  await openWithWrongDeviceClock(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Transações" }).click();
  await page.getByRole("button", { name: "Novo lançamento" }).first().click();
  await expect(page.getByRole("dialog").getByLabel("Data", { exact: true })).toHaveValue(today);
});

test("o rotulo Hoje na lista de transacoes segue o dia do servidor", async ({ page, request }) => {
  const today = await serverToday(request);
  const headers = await apiHeaders(request, ADMIN);
  const account = await apiPost(request, headers, "/accounts", {
    name: "Conta Relogio E2E", type: "asset", currency_code: "BRL", opening_balance: "100.00", opening_balance_date: "2026-01-01",
  });
  await apiPost(request, headers, "/transactions", {
    splits: [{ type: "withdrawal", date: today, description: "Compra do dia do servidor", amount: "9.90", currency_code: "BRL", account_id: account.id, counterparty_name: "Loja Relogio" }],
  });
  await openWithWrongDeviceClock(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Transações" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Hoje" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Hoje" })).toContainText("Compra do dia do servidor");
});

test("os periodos das telas de orcamentos e contas a pagar usam o dia do servidor", async ({ page, request }) => {
  const today = await serverToday(request);
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${today.slice(0, 7)}-01T00:00:00Z`))
    .replace(/^./, (letter) => letter.toUpperCase());
  await openWithWrongDeviceClock(page);
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await nav.getByRole("link", { name: "Orçamentos" }).click();
  // Com o relogio do aparelho em 2020 o mes mostrado seria janeiro de 2020
  await expect(page.getByText(monthLabel, { exact: true })).toBeVisible();
  await expect(page.getByText("Janeiro de 2020")).toHaveCount(0);
});

test("sem o relogio do aparelho errado, o comportamento e o mesmo (referencia)", async ({ page, request }) => {
  const today = await serverToday(request);
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Transações" }).click();
  await page.getByRole("button", { name: "Novo lançamento" }).first().click();
  await expect(page.getByRole("dialog").getByLabel("Data", { exact: true })).toHaveValue(today);
});
