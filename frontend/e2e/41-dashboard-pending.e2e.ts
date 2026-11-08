import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard, setDefaultCurrency } from "./helpers";

// Painel inicial com lancamentos pendentes: a conta a pagar do jeito do Mobills e um lancamento ainda nao efetivado. O
// atrasado leva o selo "Atrasada" e entra nos alertas; o link leva a lista filtrada em Pendentes.
test.describe.configure({ mode: "serial" });

const LATE = "Vencida Painel Pend E2E";
const SOON = "Proxima Painel Pend E2E";
const PAID = "Paga Painel Pend E2E";
const ACCOUNT = "Conta Painel Pend E2E";

// O app usa o "hoje" do servidor (America/Sao_Paulo): o executor pode estar em outro fuso
const day = (plusDays: number) => {
  const base = new Date(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) + "T12:00:00Z");
  base.setUTCDate(base.getUTCDate() + plusDays);
  return base.toISOString().slice(0, 10);
};

const upcomingBlock = (page: Page) => page.getByRole("region", { name: "Próximos vencimentos" });

test("prepara um pendente atrasado, um pendente proximo e um ja pago pela API", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  await setDefaultCurrency(request, headers, "BRL");
  const account = await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    currency_code: "BRL",
    opening_balance: "5000.00",
    opening_balance_date: "2026-01-01",
  });
  const tx = (description: string, on: string, extra: Record<string, unknown> = {}) =>
    apiPost(request, headers, "/transactions", {
      splits: [
        {
          type: "withdrawal",
          date: on,
          description,
          amount: "75.00",
          currency_code: "BRL",
          account_id: account.id,
          counterparty_name: "Fornecedor Painel",
          ...extra,
        },
      ],
    });
  await tx(LATE, day(-3), { is_paid: false });
  await tx(SOON, day(4), { is_paid: false });
  await tx(PAID, day(2));
});

test("o painel lista os pendentes, o atrasado com selo, e nao lista o que ja foi pago", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  const block = upcomingBlock(page);
  await expect(block.getByText(LATE, { exact: true })).toBeVisible();
  await expect(block.getByText(SOON, { exact: true })).toBeVisible();
  await expect(block.getByText(PAID, { exact: true })).toHaveCount(0);

  const late = block.getByRole("listitem").filter({ hasText: LATE });
  await expect(late.getByText("Atrasada", { exact: true })).toBeVisible();
  await expect(late).toContainText("R$ 75,00");
  await expect(block.getByRole("listitem").filter({ hasText: SOON }).getByText("Atrasada", { exact: true })).toHaveCount(0);
});

test("o pendente atrasado entra nos alertas, com link para a lista de pendentes", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  const link = page.getByLabel("Alertas").getByRole("link", { name: /pendentes? atrasados?/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/transacoes\?situacao=pending/);
  await expect(page.getByRole("main").getByText(LATE, { exact: true })).toBeVisible();
});

test("Ver pendentes leva a lista filtrada em Pendentes", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await upcomingBlock(page).getByRole("link", { name: "Ver pendentes" }).click();
  await expect(page).toHaveURL(/\/transacoes\?situacao=pending/);
  await expect(page.getByRole("main").getByText(SOON, { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText(PAID, { exact: true })).toHaveCount(0);

  // A gaveta de filtros chega fechada, entao o menu da linha esta ao alcance (aberta, ela cobria os botoes)
  await expect(page.getByRole("button", { name: /^Filtros/ })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: `Ações do lançamento ${SOON}` }).click();
  await expect(page.getByRole("menuitem", { name: "Efetivar" })).toBeVisible();
});

test("efetivar o pendente atrasado tira ele do painel", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  // So a busca na URL: com um filtro do painel na URL a gaveta de filtros abre sozinha e cobre o menu da linha
  await page.goto(`/transacoes?busca=${encodeURIComponent(LATE)}`);
  await page.getByRole("button", { name: `Ações do lançamento ${LATE}` }).click();
  await page.getByRole("menuitem", { name: "Efetivar" }).click();

  await page.goto("/");
  await expect(upcomingBlock(page).getByText(SOON, { exact: true })).toBeVisible();
  await expect(upcomingBlock(page).getByText(LATE, { exact: true })).toHaveCount(0);
});
