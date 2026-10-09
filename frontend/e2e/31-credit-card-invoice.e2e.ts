import { expect, test, type APIRequestContext } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Fatura do cartao de credito: fechamento, vencimento e quais compras caem em cada mes. Roda
// depois do 01 (que cria o administrador).
test.describe.configure({ mode: "serial" });

async function serverToday(request: APIRequestContext): Promise<string> {
  const headers = await apiHeaders(request, ADMIN);
  const response = await request.get("/api/v1/clock", { headers });
  expect(response.status()).toBe(200);
  return (await response.json()).today;
}

// Fechamento no ultimo dia do mes: a fatura do mes corrente passa a coincidir com o mes do
// calendario, o que deixa o teste previsivel sem depender do dia exato de hoje.
async function createCard(request: APIRequestContext, name: string) {
  const headers = await apiHeaders(request, ADMIN);
  return apiPost(request, headers, "/accounts", {
    name,
    type: "asset",
    role: "credit_card",
    currency_code: "BRL",
    opening_balance: "0",
    closing_day: 31,
    due_day: 15,
  });
}

test("cartao de credito mostra a fatura do mes com a compra, o periodo e o vencimento", async ({ page, request }) => {
  const today = await serverToday(request);
  const card = await createCard(request, "Cartao E2E");
  const headers = await apiHeaders(request, ADMIN);
  await apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "withdrawal",
        date: today,
        description: "Compra no cartao",
        amount: "123.45",
        currency_code: "BRL",
        account_id: card.id,
        counterparty_name: "Loja E2E",
      },
    ],
  });

  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Contas", exact: true }).click();
  await page
    .getByRole("heading", { level: 3, name: "Cartao E2E" })
    .locator("xpath=ancestor::li")
    .getByRole("button", { name: "Ações da conta Cartao E2E" })
    .click();
  await page.getByRole("menuitem", { name: "Ver fatura" }).click();

  await expect(page).toHaveURL(new RegExp(`/contas/${card.id}/fatura$`));
  await expect(page.getByRole("heading", { level: 1, name: "Fatura de Cartao E2E" })).toBeVisible();
  await expect(page.getByText("R$ 123,45").first()).toBeVisible();
  await expect(page.getByText("Compra no cartao")).toBeVisible();
});

test("mes sem compras mostra o aviso vazio e a navegacao troca de mes", async ({ page, request }) => {
  const card = await createCard(request, "Cartao Vazio E2E");

  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Contas", exact: true }).click();
  await page
    .getByRole("heading", { level: 3, name: "Cartao Vazio E2E" })
    .locator("xpath=ancestor::li")
    .getByRole("button", { name: "Ações da conta Cartao Vazio E2E" })
    .click();
  await page.getByRole("menuitem", { name: "Ver fatura" }).click();

  await expect(page.getByText("Nenhuma compra nessa fatura")).toBeVisible();
  await page.getByRole("button", { name: "Mês anterior" }).click();
  await expect(page.getByText("Nenhuma compra nessa fatura")).toBeVisible();
});

test("cartao sem fechamento e vencimento configurados pede para editar a conta", async ({ page, request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const card = await apiPost(request, headers, "/accounts", {
    name: "Cartao Sem Config E2E",
    type: "asset",
    role: "credit_card",
    currency_code: "BRL",
    opening_balance: "0",
  });

  await loginAndWaitForDashboard(page);
  await page.goto(`/contas/${card.id}/fatura`);
  await expect(
    page.getByText("Esta conta ainda não tem dia de fechamento e de vencimento configurados. Edite a conta para ver a fatura."),
  ).toBeVisible();
});

test("marcar fatura como paga abre a transferencia ja preenchida e conclui o pagamento", async ({ page, request }) => {
  const card = await createCard(request, "Cartao Pagamento E2E");
  const headers = await apiHeaders(request, ADMIN);
  const today = await serverToday(request);
  await apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "withdrawal",
        date: today,
        description: "Compra a pagar",
        amount: "50.00",
        currency_code: "BRL",
        account_id: card.id,
        counterparty_name: "Loja E2E",
      },
    ],
  });
  await apiPost(request, headers, "/accounts", {
    name: "Carteira Pagamento E2E",
    type: "asset",
    currency_code: "BRL",
    opening_balance: "500.00",
    opening_balance_date: "2026-01-01",
  });

  await loginAndWaitForDashboard(page);
  await page.goto(`/contas/${card.id}/fatura`);
  await expect(page.getByText("R$ 50,00").first()).toBeVisible();
  await page.getByRole("button", { name: "Marcar fatura como paga" }).click();

  const form = page.getByRole("dialog");
  await expect(form.getByRole("radio", { name: "Transferência" })).toBeChecked();
  await expect(form.getByLabel("Para a conta")).toHaveValue(card.id);
  await expect(form.getByLabel(/^Valor/)).toHaveValue("50,00");
  await form.getByLabel("Conta", { exact: true }).selectOption({ label: "Carteira Pagamento E2E" });
  await form.getByRole("button", { name: "Criar lançamento" }).click();

  await expect(form).toBeHidden();
});
