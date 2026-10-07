import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, field } from "./helpers";

const today = () => new Date().toLocaleDateString("sv-SE");

// Roda depois do 01 (que cria o administrador). Confere a ponta a ponta do idioma: o seletor na tela de
// login, o app inteiro em ingles e o texto que o servidor gera (CSV) seguindo o Accept-Language do navegador.
test.describe.configure({ mode: "serial" });

test("o seletor de idioma na tela de login troca para ingles, e a escolha fica salva em Configurações", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();

  await page.getByRole("button", { name: "Mudar para inglês" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(field(page, "Email")).toBeVisible();

  await field(page, "Email").fill(ADMIN.email);
  await field(page, "Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(`Hi, ${ADMIN.name.split(" ")[0]}.`)).toBeVisible();

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "English" })).toBeChecked();

  // Volta para portugues pelo mesmo seletor usado em Configuracoes, para nao vazar estado para os testes seguintes
  await page.getByRole("radio", { name: "Português (Brasil)" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
});

test("exportar relatorios em ingles baixa o CSV com cabecalho, separador e decimal do idioma", async ({ page, request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const account = await apiPost(request, headers, "/accounts", {
    name: "English E2E Account",
    type: "asset",
    currency_code: "BRL",
    opening_balance: "0",
    opening_balance_date: "2026-01-01",
  });
  await apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "withdrawal",
        date: today(),
        description: "Groceries",
        amount: "1234.50",
        currency_code: "BRL",
        account_id: account.id,
        counterparty_name: "Supermarket",
      },
    ],
  });

  // Este navegador ja chega com o idioma salvo em ingles: simula quem abre o app pela primeira vez com o
  // navegador em ingles, sem passar pelo seletor
  await page.addInitScript(() => localStorage.setItem("peculio-language", "en"));
  await page.goto("/login");
  await field(page, "Email").fill(ADMIN.email);
  await field(page, "Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await page.getByLabel("Account", { exact: true }).selectOption({ label: "English E2E Account" });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^transactions-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  const text = readFileSync(path!, "utf-8");
  const lines = text.slice(1).trim().split("\r\n");
  expect(lines[0]).toBe(
    "date,type,description,source_account,destination_account,amount,currency,foreign_amount,foreign_currency,category,budget,tags,notes",
  );
  expect(lines[1]).toContain("Expense");
  expect(lines[1]).toContain("1234.50");
});
