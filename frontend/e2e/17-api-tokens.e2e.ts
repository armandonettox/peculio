import { expect, test, type Page } from "@playwright/test";

import { loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01 (que cria o administrador). Em ordem: cada passo parte do estado do anterior.
test.describe.configure({ mode: "serial" });

const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) => page.getByRole("dialog");
const list = (page: Page) => page.getByRole("list", { name: "Tokens de API" });
const item = (page: Page, name: string) => list(page).getByRole("heading", { level: 3, name }).locator("xpath=ancestor::li[1]");
const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });

// O valor de cada token so existe na hora em que ele e criado: os passos seguintes usam o que este guardou
const values = { reader: "", writer: "" };

async function openSecurity(page: Page) {
  await loginAndWaitForDashboard(page);
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await page.getByRole("menuitem", { name: "Segurança" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Segurança" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tokens de API" })).toBeVisible();
}

/** Cria um token pela tela e devolve o valor mostrado uma unica vez. */
async function createToken(page: Page, name: string, options: { write?: boolean; validity?: string } = {}) {
  await page.getByRole("button", { name: "Criar token" }).click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill(name);
  if (options.write) await dialog(page).getByRole("radio", { name: /Leitura e escrita/ }).check();
  if (options.validity) await dialog(page).getByLabel("Validade").selectOption({ label: options.validity });
  await dialog(page).getByRole("button", { name: "Criar token" }).click();
  const shown = dialog(page).getByLabel("Token", { exact: true });
  await expect(shown).toBeVisible();
  const value = (await shown.textContent()) ?? "";
  expect(value).toMatch(/^fin_[\w-]{43}$/);
  await dialog(page).getByLabel("Copiei o token e guardei em um lugar seguro").check();
  await dialog(page).getByRole("button", { name: "Concluir" }).click();
  await expect(dialog(page)).toBeHidden();
  return value;
}

test("cria um token de leitura pela tela: o valor aparece uma vez e a lista guarda so o comeco", async ({ page }) => {
  await openSecurity(page);
  await expect(main(page).getByText("Você ainda não tem nenhum token.")).toBeVisible();

  values.reader = await createToken(page, "Leitor E2E");

  const row = item(page, "Leitor E2E");
  await expect(row).toContainText("Só leitura");
  await expect(row).toContainText(`${values.reader.slice(0, 12)}…`);
  await expect(row).toContainText(/Vence em \d{2}\/\d{2}\/\d{4}/);
  await expect(row).toContainText("Nunca usado");
  // O valor completo nunca volta para a tela
  await expect(page.getByText(values.reader)).toHaveCount(0);
});

test("o token de leitura consulta com a API mas nao escreve nem gerencia tokens", async ({ request }) => {
  const reader = bearer(values.reader);
  const ok = await request.get("/api/v1/accounts", { headers: reader });
  expect(ok.status()).toBe(200);
  expect((await request.get("/api/v1/auth/me", { headers: reader })).status()).toBe(200);

  const write = await request.post("/api/v1/accounts", {
    headers: reader,
    data: { name: "Conta que nao deve existir", type: "asset", currency_code: "BRL", opening_balance: "1.00" },
  });
  expect(write.status()).toBe(403);
  expect((await write.json()).code).toBe("api_token_read_only");

  // Token nunca cria outro token, lista tokens nem renova a sessao
  for (const response of [
    await request.post("/api/v1/api-tokens", { headers: reader, data: { name: "Filho", scope: "write" } }),
    await request.get("/api/v1/api-tokens", { headers: reader }),
    await request.post("/api/v1/auth/refresh", { headers: reader }),
  ]) {
    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe("session_required");
  }
});

test("depois de usado, a lista mostra a data do ultimo uso", async ({ page }) => {
  await openSecurity(page);
  await expect(item(page, "Leitor E2E")).toContainText(/Último uso: \d{2}\/\d{2}\/\d{4}/);
  await expect(item(page, "Leitor E2E")).not.toContainText("Nunca usado");
});

test("token de leitura e escrita sem validade: escreve pela API e a lista diz que nunca expira", async ({ page, request }) => {
  await openSecurity(page);
  values.writer = await createToken(page, "Escritor E2E", { write: true, validity: "Nunca expira" });
  await expect(item(page, "Escritor E2E")).toContainText("Leitura e escrita");
  await expect(item(page, "Escritor E2E")).toContainText("Nunca expira");

  const created = await request.post("/api/v1/accounts", {
    headers: bearer(values.writer),
    data: { name: "Conta Token E2E", type: "asset", currency_code: "BRL", opening_balance: "10.00" },
  });
  expect(created.status()).toBe(201);
  const listed = await request.get("/api/v1/accounts", { headers: bearer(values.reader) });
  expect((await listed.json()).items.map((account: { name: string }) => account.name)).toContain("Conta Token E2E");
});

test("nome repetido avisa no campo e a janela continua aberta", async ({ page }) => {
  await openSecurity(page);
  await page.getByRole("button", { name: "Criar token" }).click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill("leitor e2e");
  await dialog(page).getByRole("button", { name: "Criar token" }).click();
  await expect(dialog(page).getByText("Já existe um token com esse nome.")).toBeVisible();
  await expect(dialog(page).getByLabel("Token", { exact: true })).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog(page)).toBeHidden();
});

test("a janela com o valor nao fecha por Esc antes de marcar que guardou", async ({ page }) => {
  await openSecurity(page);
  await page.getByRole("button", { name: "Criar token" }).click();
  await dialog(page).getByLabel("Nome", { exact: true }).fill("Esc E2E");
  await dialog(page).getByRole("button", { name: "Criar token" }).click();
  await expect(dialog(page).getByLabel("Token", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Concluir" })).toBeDisabled();
  await dialog(page).getByLabel("Copiei o token e guardei em um lugar seguro").check();
  await dialog(page).getByRole("button", { name: "Concluir" }).click();
  await expect(dialog(page)).toBeHidden();
  // Revoga o token de teste para nao sobrar lixo
  await page.getByRole("button", { name: "Revogar o token Esc E2E" }).click();
  await dialog(page).getByRole("button", { name: "Revogar" }).click();
  await expect(item(page, "Esc E2E")).toHaveCount(0);
});

test("revogar corta o token na hora: some da lista e a API passa a recusar", async ({ page, request }) => {
  await openSecurity(page);
  await page.getByRole("button", { name: "Revogar o token Leitor E2E" }).click();
  await expect(dialog(page).getByText("Leitor E2E")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(item(page, "Leitor E2E")).toBeVisible();

  await page.getByRole("button", { name: "Revogar o token Leitor E2E" }).click();
  await dialog(page).getByRole("button", { name: "Revogar" }).click();
  await expect(item(page, "Leitor E2E")).toHaveCount(0);
  await expect(item(page, "Escritor E2E")).toBeVisible();

  const refused = await request.get("/api/v1/accounts", { headers: bearer(values.reader) });
  expect(refused.status()).toBe(401);
  expect((await refused.json()).code).toBe("token_invalid");
  // O outro token continua valendo
  expect((await request.get("/api/v1/accounts", { headers: bearer(values.writer) })).status()).toBe(200);
});

test("a secao de tokens nao faz a pagina rolar para o lado no celular", async ({ page }) => {
  await openSecurity(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(item(page, "Escritor E2E")).toBeVisible();
  let widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.window);

  await page.getByRole("button", { name: "Criar token" }).click();
  await expect(dialog(page)).toBeVisible();
  widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.window);
});
