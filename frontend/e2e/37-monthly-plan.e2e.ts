import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard, setDefaultCurrency } from "./helpers";

// Planejamento Mensal: o assistente de 3 etapas, a tabela por categoria e o gasto que vem dos lancamentos. Usa um mes
// fixo (marco de 2026) para nao depender do dia em que o teste roda. Em ordem: cada passo parte do anterior.
test.describe.configure({ mode: "serial" });

const MONTH = "2026-03";
const CATEGORY = "Mercado Plano E2E";
const OTHER = "Lazer Plano E2E";

const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");

async function openPlanning(page: Page) {
  await loginAndWaitForDashboard(page);
  await page.goto(`/orcamentos?mes=${MONTH}`);
  await expect(page.getByRole("heading", { level: 1, name: "Orçamentos" })).toBeVisible();
}

test("prepara categorias e um gasto de marco pela API", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  await setDefaultCurrency(request, headers, "BRL");
  const mercado = await apiPost(request, headers, "/categories", { name: CATEGORY, kind: "expense", color: "#E11D48" });
  await apiPost(request, headers, "/categories", { name: OTHER, kind: "expense", color: "#2563EB" });
  const account = await apiPost(request, headers, "/accounts", {
    name: "Conta Plano E2E",
    type: "asset",
    currency_code: "BRL",
    opening_balance: "9000.00",
    opening_balance_date: "2026-01-01",
  });
  await apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "withdrawal",
        date: `${MONTH}-10`,
        description: "Compra do mes",
        amount: "300.00",
        currency_code: "BRL",
        account_id: account.id,
        counterparty_name: "Mercado Plano",
        category_id: mercado.id,
      },
    ],
  });
});

test("sem plano no mes, a tela convida a criar um", async ({ page }) => {
  await openPlanning(page);
  await expect(page.getByText(/Nenhum orçamento definido para/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar planejamento do mês anterior" })).toBeVisible();
});

test("cria o planejamento pelo assistente de 3 etapas", async ({ page }) => {
  await openPlanning(page);
  await page.getByRole("button", { name: "Definir novo planejamento" }).click();
  await expect(page.getByRole("heading", { name: /Criação do planejamento mensal/ })).toBeVisible();

  // Etapa 1: renda de 5.000,00 e 20% de economia: 4.000,00 para gastar
  await page.getByLabel("Quanto você ganha por mês?").fill("5000,00");
  await expect(page.getByText("R$ 4.000,00")).toBeVisible();
  await page.getByRole("button", { name: "Avançar" }).click();

  // Etapa 2: limites por categoria (o que passa do orcamento trava o botao)
  await page.getByRole("button", { name: "Gerenciar categorias" }).click();
  await dialog(page).getByRole("checkbox", { name: CATEGORY }).check();
  await dialog(page).getByRole("checkbox", { name: OTHER }).check();
  await dialog(page).getByRole("button", { name: "Aplicar" }).click();
  await page.getByLabel(`Limite de ${CATEGORY}`).fill("1000,00");
  await page.getByLabel(`Limite de ${OTHER}`).fill("5000,00");
  await expect(page.getByText(/Passou .* do orçamento de gastos/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Avançar" })).toBeDisabled();
  await page.getByLabel(`Limite de ${OTHER}`).fill("500,00");
  await page.getByRole("button", { name: "Avançar" }).click();

  // Etapa 3: o cartao conta pela data da fatura
  await page.getByRole("radio", { name: /Pela data da fatura/ }).check();
  await page.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByText("Você criou seu planejamento mensal!")).toBeVisible();

  await page.getByRole("button", { name: "Ver planejamento" }).click();
  await expect(page).toHaveURL(new RegExp(`/orcamentos\\?mes=${MONTH}`));
});

test("a tabela mostra o gasto do mes por categoria e o que resta", async ({ page }) => {
  await openPlanning(page);
  const table = page.getByRole("region", { name: /Orçamento por categoria/ });
  const row = table.getByRole("row", { name: new RegExp(CATEGORY) });
  await expect(row).toContainText("R$ 1.000,00");
  await expect(row).toContainText("R$ 300,00");
  await expect(row).toContainText("Restam R$ 700,00");
  await expect(table.getByRole("row", { name: new RegExp(OTHER) })).toContainText("R$ 500,00");
  await expect(table.getByRole("row", { name: /Categorias restantes/ })).toBeVisible();
  // Receitas, gastos planejados e economia nos cartoes laterais
  await expect(main(page)).toContainText("R$ 4.000,00");
});

test("edita o limite de uma categoria", async ({ page }) => {
  await openPlanning(page);
  await page.getByRole("button", { name: `Editar limite de ${CATEGORY}` }).click();
  await dialog(page).getByLabel(`Limite de ${CATEGORY}`).fill("1200,00");
  await dialog(page).getByRole("button", { name: "Salvar" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole("row", { name: new RegExp(CATEGORY) })).toContainText("Restam R$ 900,00");
});

test("muda a visualizacao do cartao pelo menu", async ({ page }) => {
  await openPlanning(page);
  await page.getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: "Visualização das despesas no cartão" }).click();
  await expect(dialog(page).getByRole("radio", { name: /Pela data da fatura/ })).toBeChecked();
  await dialog(page).getByRole("radio", { name: /Pela data da compra/ }).check();
  await dialog(page).getByRole("button", { name: "Salvar" }).click();
  await expect(dialog(page)).toBeHidden();
});

test("copia o plano de marco para abril", async ({ page }) => {
  await openPlanning(page);
  await page.getByRole("button", { name: "Próximo mês" }).click();
  await expect(page.getByText(/Nenhum orçamento definido para/)).toBeVisible();
  await page.getByRole("button", { name: "Copiar planejamento do mês anterior" }).click();
  await expect(page.getByRole("row", { name: new RegExp(CATEGORY) })).toContainText("R$ 1.200,00");
});

test("exclui o limite de uma categoria e, depois, todos os planejamentos", async ({ page }) => {
  await openPlanning(page);
  await page.getByRole("button", { name: `Excluir limite de ${OTHER}` }).click();
  await dialog(page).getByRole("button", { name: /Excluir/ }).click();
  await expect(page.getByRole("row", { name: new RegExp(OTHER) })).toHaveCount(0);

  await page.getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: "Excluir planejamentos" }).click();
  await dialog(page).getByRole("button", { name: /Excluir/ }).click();
  await expect(page.getByText(/Nenhum orçamento definido para/)).toBeVisible();
});
