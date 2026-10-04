import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const ACCOUNT = "Conta Extrato E2E";
const main = (page: Page) => page.getByRole("main");
const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });
const row = (page: Page, line: number) => page.getByRole("checkbox", { name: `Importar a linha ${line}` }).locator("xpath=ancestor::tr[1]");
const importButton = (page: Page) => page.getByRole("button", { name: /^Importar \d+ lançamento|^Nada marcado/ });

const CSV = [
  "Data;Descricao;Valor",
  "05/03/2026;Mercado Extrato E2E;-50,00",
  "06/03/2026;Salario Extrato E2E;1.000,00",
  "07/03/2026;Linha ruim E2E;abc",
  "",
].join("\n");

const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260308120000
<TRNAMT>-30.00
<FITID>E2E-OFX-1
<MEMO>Padaria OFX E2E
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260309
<TRNAMT>200.00
<FITID>E2E-OFX-2
<NAME>Reembolso OFX E2E
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`;

// Cabecalho que o app nao reconhece: ele precisa pedir as colunas
const CSV_COLUNAS = ["Dia;Texto;Entrada;Saida;Saldo", "10/03/2026;Mercado Colunas E2E;;45,90;900,00", "11/03/2026;Deposito Colunas E2E;300,00;;1200,00", ""].join("\n");

let accountId = "";

async function balance(request: APIRequestContext): Promise<string> {
  const headers = await apiHeaders(request);
  const response = await request.get(`/api/v1/accounts/${accountId}`, { headers });
  expect(response.status()).toBe(200);
  return (await response.json()).balance;
}

async function openImport(page: Page) {
  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Importar extrato" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Importar extrato" })).toBeVisible();
}

async function readFile(page: Page, name: string, content: string, mimeType = "text/csv") {
  await page.getByLabel("Conta que recebe o extrato").selectOption({ label: `${ACCOUNT} (BRL)` });
  await page.getByLabel("Arquivo do extrato (CSV ou OFX)").setInputFiles({ name, mimeType, buffer: Buffer.from(content, "utf-8") });
  await expect(main(page).getByText(name)).toBeVisible();
  await page.getByRole("button", { name: "Ver prévia" }).click();
}

test("prepara a conta pela API", async ({ request }) => {
  const headers = await apiHeaders(request, ADMIN);
  const account = await apiPost(request, headers, "/accounts", {
    name: ACCOUNT,
    type: "asset",
    role: "checking",
    currency_code: "BRL",
    opening_balance: "1000.00",
  });
  accountId = account.id;
  expect(await balance(request)).toBe("1000.00");
});

test("importa um CSV: a previa separa novas e erro, e o saldo muda so com as linhas marcadas", async ({ page, request }) => {
  await openImport(page);
  await readFile(page, "extrato.csv", CSV);

  await expect(main(page).getByRole("status").first()).toContainText("2 novas · 0 repetidas · 1 com erro");
  await expect(row(page, 2)).toContainText("Mercado Extrato E2E");
  await expect(row(page, 2)).toContainText("Nova");
  await expect(row(page, 3)).toContainText("R$ 1.000,00");
  // A linha com erro mostra o motivo, nao tem como marcar e nunca entra
  await expect(row(page, 4)).toContainText("Erro");
  await expect(row(page, 4)).toContainText("Valor invalido");
  await expect(page.getByRole("checkbox", { name: "Importar a linha 4" })).toBeDisabled();

  await expect(importButton(page)).toHaveText("Importar 2 lançamentos");
  await importButton(page).click();
  await expect(page.getByRole("heading", { name: "2 lançamentos importados" })).toBeVisible();
  expect(await balance(request)).toBe("1950.00");

  await page.getByRole("link", { name: "Ver lançamentos" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Transações" })).toBeVisible();
  // Na rodada completa a lista ja tem muita coisa de outros testes: o lancamento importado e conferido pela API
  const headers = await apiHeaders(request);
  const found = await request.get("/api/v1/transactions", { headers, params: { q: "Salario Extrato E2E" } });
  expect((await found.json()).total).toBe(1);
});

test("o mesmo CSV de novo: tudo parece repetido e vem desmarcado, e marcar a mao importa so aquela linha", async ({ page, request }) => {
  await openImport(page);
  await readFile(page, "extrato.csv", CSV);

  await expect(main(page).getByRole("status").first()).toContainText("0 novas · 2 repetidas · 1 com erro");
  await expect(row(page, 2)).toContainText("Parece repetida");
  await expect(page.getByRole("checkbox", { name: "Importar a linha 2" })).not.toBeChecked();
  await expect(importButton(page)).toBeDisabled();
  await expect(importButton(page)).toHaveText("Nada marcado para importar");

  await page.getByRole("checkbox", { name: "Importar a linha 2" }).check();
  await expect(importButton(page)).toHaveText("Importar 1 lançamento");
  await importButton(page).click();
  await expect(page.getByRole("heading", { name: "1 lançamento importados" })).toBeVisible();
  // Saiu mais um mercado de 50,00
  expect(await balance(request)).toBe("1900.00");
});

test("OFX: importa e, ao reimportar o mesmo arquivo, as linhas aparecem como ja importadas", async ({ page, request }) => {
  await openImport(page);
  await readFile(page, "extrato.ofx", OFX, "application/x-ofx");

  await expect(main(page).getByRole("status").first()).toContainText("2 novas · 0 repetidas · 0 com erro");
  // OFX nao tem passo de colunas
  await expect(page.getByRole("button", { name: "Ajustar colunas" })).toHaveCount(0);
  await expect(row(page, 1)).toContainText("Padaria OFX E2E");
  await expect(row(page, 2)).toContainText("Reembolso OFX E2E");
  await importButton(page).click();
  await expect(page.getByRole("heading", { name: "2 lançamentos importados" })).toBeVisible();
  expect(await balance(request)).toBe("2070.00");

  await page.getByRole("button", { name: "Importar outro extrato" }).click();
  await readFile(page, "extrato.ofx", OFX, "application/x-ofx");
  await expect(main(page).getByRole("status").first()).toContainText("0 novas · 2 repetidas");
  await expect(row(page, 1)).toContainText("Já importada");
  await expect(row(page, 2)).toContainText("Já importada");
  await expect(importButton(page)).toBeDisabled();
  expect(await balance(request)).toBe("2070.00");
});

test("CSV com cabecalho desconhecido: pede as colunas, com debito e credito separados", async ({ page, request }) => {
  await openImport(page);
  await readFile(page, "colunas.csv", CSV_COLUNAS);
  await expect(page.getByText(/Não deu para descobrir sozinho/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "3. Entrada" })).toBeVisible();

  // Sem escolher nada, cada campo avisa
  await page.getByRole("button", { name: "Ver prévia" }).click();
  await expect(page.getByText("Escolha a coluna da data.")).toBeVisible();
  await expect(page.getByText("Escolha a coluna do valor.")).toBeVisible();

  await page.getByLabel("Coluna da data").selectOption({ label: "1. Dia" });
  await page.getByLabel("Coluna da descrição").selectOption({ label: "2. Texto" });
  await page.getByRole("radio", { name: "Duas colunas: débito (saída) e crédito (entrada)" }).check();
  await page.getByLabel("Coluna de débito").selectOption({ label: "4. Saida" });
  await page.getByLabel("Coluna de crédito").selectOption({ label: "3. Entrada" });
  await page.getByRole("button", { name: "Ver prévia" }).click();

  await expect(main(page).getByRole("status").first()).toContainText("2 novas · 0 repetidas · 0 com erro");
  await expect(row(page, 2)).toContainText("Mercado Colunas E2E");
  await expect(row(page, 3)).toContainText("Deposito Colunas E2E");
  await importButton(page).click();
  await expect(page.getByRole("heading", { name: "2 lançamentos importados" })).toBeVisible();
  // 2070,00 - 45,90 + 300,00
  expect(await balance(request)).toBe("2324.10");
});

test("a previa e o passo das colunas nao fazem a pagina rolar para o lado no celular", async ({ page }) => {
  // Abre a tela no tamanho normal (no celular o menu fica escondido) e so depois estreita a janela
  await openImport(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await readFile(page, "colunas.csv", CSV_COLUNAS);
  await expect(page.getByText(/Não deu para descobrir sozinho/)).toBeVisible();
  const mapping = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
  expect(mapping.page).toBeLessThanOrEqual(mapping.window);

  await page.getByRole("button", { name: "Voltar" }).click();
  await readFile(page, "extrato.csv", CSV);
  await expect(main(page).getByRole("status").first()).toContainText("repetidas");
  const preview = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
  expect(preview.page).toBeLessThanOrEqual(preview.window);
});

test("o menu leva a importacao e sem arquivo a tela avisa", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await nav(page).getByRole("link", { name: "Importar extrato" }).click();
  await expect(page).toHaveURL(/\/importar$/);
  await expect(page.getByLabel("Conta que recebe o extrato")).toBeVisible();
  await expect(page.getByLabel("Arquivo do extrato (CSV ou OFX)")).toHaveCount(1);
  // Com uma conta so o app ja a escolhe (o aviso da conta tem teste unitario); sem arquivo o aviso aparece
  await page.getByRole("button", { name: "Ver prévia" }).click();
  await expect(page.getByText("Escolha o arquivo do extrato.")).toBeVisible();
});
