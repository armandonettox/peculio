import { expect, test, type Page } from "@playwright/test";

import { apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Compra parcelada no cartao de credito: gera uma transacao por mes, cada uma na fatura certa.
// Roda depois do 01 (que cria o administrador).
test.describe.configure({ mode: "serial" });

const CARD = "Cartao Parcelamento E2E";

const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const input = (page: Page, label: string) => dialog(page).getByLabel(label, { exact: true });
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });

async function goTo(page: Page, link: "Transações" | "Contas") {
  await nav(page).getByRole("link", { name: link, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: link })).toBeVisible();
}

test("prepara um cartao de credito pela API", async ({ request }) => {
  const headers = await apiHeaders(request);
  await apiPost(request, headers, "/accounts", {
    name: CARD,
    type: "asset",
    role: "credit_card",
    currency_code: "BRL",
    opening_balance: "0",
    closing_day: 28,
    due_day: 5,
  });
});

test("comprar em 3x no cartao cria 3 lancamentos, um por mes, com o rotulo da parcela", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await goTo(page, "Transações");
  await page.getByRole("button", { name: "Novo lançamento" }).click();
  await expect(dialog(page)).toBeVisible();

  await input(page, "Conta").selectOption({ label: CARD });
  await input(page, "Descrição").fill("Notebook");
  await input(page, "Para quem").fill("Loja de Eletronicos");
  await input(page, "Valor (BRL)").fill("300,00");
  await input(page, "Parcelar em quantas vezes?").selectOption("3");
  await dialog(page).getByRole("button", { name: "Criar lançamento" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByText("Notebook (1/3)")).toBeVisible();
  await expect(main(page).getByText("1/3")).toBeVisible();
  await expect(main(page).getByText("2/3")).toBeVisible();
  await expect(main(page).getByText("3/3")).toBeVisible();
});
