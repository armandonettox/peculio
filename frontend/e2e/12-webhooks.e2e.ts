import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, apiPost, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const NAME = "Webhook E2E";
const TOKEN = "tokenSecretoNaUrl123";
const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const card = (page: Page) => main(page).getByRole("heading", { level: 3, name: NAME }).locator("xpath=ancestor::li[1]");
const today = () => new Date().toLocaleDateString("sv-SE");

type Received = { headers: IncomingHttpHeaders; body: string };

// Receptor local: o backend da pilha de teste alcanca a maquina por host.docker.internal.
// So o executor do E2E libera destinos locais (WEBHOOK_ALLOW_PRIVATE); o padrao do app recusa.
const received: Received[] = [];
let receiver: Server;
let url = "";
let secret = "";
const state = { accountId: "" };

test.beforeAll(async () => {
  receiver = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf-8") });
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("recebido pelo receptor do E2E");
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "0.0.0.0", resolve));
  const { port } = receiver.address() as AddressInfo;
  url = `http://host.docker.internal:${port}/hook?token=${TOKEN}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
});

async function openWebhooks(page: Page) {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Webhooks" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Webhooks" })).toBeVisible();
}

async function menu(page: Page, item: string) {
  await page.getByRole("button", { name: `Ações do webhook ${NAME}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

function signatureOf(entry: Received): string {
  const timestamp = String(entry.headers["x-finance-timestamp"]);
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${entry.body}`).digest("hex");
}

async function spend(request: Parameters<typeof apiHeaders>[0], description: string) {
  const headers = await apiHeaders(request, ADMIN);
  return apiPost(request, headers, "/transactions", {
    splits: [
      {
        type: "withdrawal",
        date: today(),
        description,
        amount: "12.34",
        currency_code: "BRL",
        account_id: state.accountId,
        counterparty_name: "Loja Webhooks",
      },
    ],
  });
}

test("sem webhooks a pagina convida a criar o primeiro", async ({ page }) => {
  await openWebhooks(page);
  await expect(page.getByText(/Nenhum webhook/)).toBeVisible();
});

test("cria o webhook, mostra o segredo uma vez e so fecha depois de marcar que guardou", async ({ page, request }) => {
  const headers = await apiHeaders(request, ADMIN);
  state.accountId = (
    await apiPost(request, headers, "/accounts", {
      name: "Conta Webhooks E2E",
      type: "asset",
      currency_code: "BRL",
      opening_balance: "1000.00",
      opening_balance_date: "2026-01-01",
    })
  ).id;

  await openWebhooks(page);
  await page.getByRole("button", { name: "Novo webhook" }).first().click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(NAME);
  await dialog(page).getByLabel("Endereço").fill(url);
  await dialog(page).getByRole("button", { name: "Criar webhook" }).click();

  const secretDialog = dialog(page);
  await expect(secretDialog.getByRole("heading", { name: "Segredo do webhook" })).toBeVisible();
  secret = (await secretDialog.getByTestId("webhook-secret").textContent()) ?? "";
  expect(secret.length).toBeGreaterThanOrEqual(32);
  await expect(secretDialog.getByRole("button", { name: "Concluir" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(secretDialog).toBeVisible();
  await secretDialog.getByLabel("Guardei o segredo").check();
  await secretDialog.getByRole("button", { name: "Concluir" }).click();
  await expect(secretDialog).toBeHidden();
  await expect(card(page)).toContainText("Lançamento criado");
});

test("a lista esconde o token da URL, mas a edicao mostra o endereco real", async ({ page }) => {
  await openWebhooks(page);
  await expect(card(page)).toContainText("/hook?***");
  await expect(card(page)).not.toContainText(TOKEN);
  await menu(page, "Editar");
  await expect(dialog(page).getByLabel("Endereço")).toHaveValue(url);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
});

test("testar entrega um aviso assinado ao receptor e mostra a resposta", async ({ page }) => {
  received.length = 0;
  await openWebhooks(page);
  await menu(page, "Testar");
  await expect(dialog(page).getByText(/Entregue com sucesso \(HTTP 200\)/)).toBeVisible();
  await expect(dialog(page).getByText("recebido pelo receptor do E2E")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Fechar" }).first().click();

  expect(received).toHaveLength(1);
  const [entry] = received;
  expect(entry.headers["x-finance-event"]).toBe("webhook.test");
  expect(entry.headers["x-finance-signature"]).toBe(signatureOf(entry));
  expect(entry.headers["content-type"]).toContain("application/json");
  expect(JSON.parse(entry.body).event).toBe("webhook.test");
});

test("um lancamento novo chega ao receptor com a assinatura certa e aparece no historico", async ({ page, request }) => {
  received.length = 0;
  const created = await spend(request, "Compra avisada ao webhook");
  await expect.poll(() => received.length, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(0);

  const entry = received[0];
  expect(entry.headers["x-finance-event"]).toBe("transaction.created");
  expect(entry.headers["x-finance-signature"]).toBe(signatureOf(entry));
  const payload = JSON.parse(entry.body);
  expect(payload.event).toBe("transaction.created");
  expect(payload.data.id).toBe(created.id);
  expect(payload.data.splits[0].description).toBe("Compra avisada ao webhook");
  // O id da entrega vai no cabecalho para o receptor deduplicar um reenvio
  expect(entry.headers["x-finance-delivery"]).toBeTruthy();

  await openWebhooks(page);
  await menu(page, "Histórico de entregas");
  // Dentro da lista: o filtro de situacao tambem tem uma opcao "Entregues"
  const delivery = dialog(page).locator("li").first();
  await expect(delivery).toContainText("Entregue");
  await expect(delivery).toContainText("Lançamento criado");
  await dialog(page).getByRole("button", { name: "Fechar" }).first().click();
});

test("pausado nao recebe aviso; retomado volta a receber", async ({ page, request }) => {
  await openWebhooks(page);
  await menu(page, "Pausar");
  await expect(card(page)).toContainText("Pausado");

  received.length = 0;
  await spend(request, "Compra com o webhook pausado");
  // Mais de um ciclo de entrega (2 s no E2E) sem chegar nada
  await page.waitForTimeout(6000);
  expect(received).toHaveLength(0);

  await menu(page, "Retomar");
  await expect(card(page)).not.toContainText("Pausado");
  await spend(request, "Compra com o webhook retomado");
  await expect.poll(() => received.length, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(0);
  expect(JSON.parse(received[0].body).data.splits[0].description).toBe("Compra com o webhook retomado");
});

test("girar o segredo mostra um novo e a assinatura passa a usar ele", async ({ page, request }) => {
  const before = secret;
  await openWebhooks(page);
  await menu(page, "Girar segredo");
  await dialog(page).getByRole("button", { name: /Girar/ }).click();
  const secretDialog = dialog(page);
  await expect(secretDialog.getByRole("heading", { name: "Segredo do webhook" })).toBeVisible();
  secret = (await secretDialog.getByTestId("webhook-secret").textContent()) ?? "";
  expect(secret).not.toBe(before);
  await secretDialog.getByLabel("Guardei o segredo").check();
  await secretDialog.getByRole("button", { name: "Concluir" }).click();

  received.length = 0;
  await spend(request, "Compra depois de girar o segredo");
  await expect.poll(() => received.length, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(0);
  expect(received[0].headers["x-finance-signature"]).toBe(signatureOf(received[0]));
});

test("exclui o webhook pedindo confirmacao", async ({ page }) => {
  await openWebhooks(page);
  await menu(page, "Excluir");
  await dialog(page).getByRole("button", { name: "Excluir" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(main(page).getByRole("heading", { level: 3, name: NAME })).toHaveCount(0);
});
