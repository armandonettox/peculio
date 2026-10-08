import { expect, test, type Page } from "@playwright/test";

import { field, loginAndWaitForDashboard, openSettings } from "./helpers";

// O contato de seguranca da instalacao: o administrador define na aba Administracao de Configuracoes, a aba Seguranca
// mostra para todos e o /.well-known/security.txt publica. Em ordem: cada passo parte do anterior.
test.describe.configure({ mode: "serial" });

// A aba Seguranca so tem o contato quando ele ja foi definido na aba Administracao
async function openSecurity(page: Page) {
  await page.getByRole("button", { name: "Segurança", exact: true }).click();
}

async function saveContact(page: Page, value: string) {
  await field(page, "Contato de segurança").fill(value);
  await page.getByRole("button", { name: "Salvar contato" }).click();
}

test("sem contato, o security.txt nao existe e a aba Seguranca nao fala de contato", async ({ page, request }) => {
  const response = await request.get("/.well-known/security.txt");
  expect(response.status()).toBe(404);
  expect((await response.json()).code).toBe("security_contact_not_set");

  await loginAndWaitForDashboard(page);
  await openSettings(page, "Administração");
  await openSecurity(page);
  await expect(page.getByRole("heading", { level: 2, name: "Verificação em duas etapas" })).toBeVisible();
  await expect(page.getByText(/relatar um problema de segurança/)).toHaveCount(0);
});

test("o administrador define um e-mail e ele aparece no security.txt e na aba Seguranca", async ({ page, request }) => {
  await loginAndWaitForDashboard(page);
  await openSettings(page, "Administração");
  await saveContact(page, "  Seguranca@Exemplo.com ");
  await expect(page.getByText("Contato salvo.")).toBeVisible();
  await expect(field(page, "Contato de segurança")).toHaveValue("seguranca@exemplo.com");

  // Publico, sem login, em texto puro e com os cabecalhos de seguranca do servidor
  const txt = await request.get("/.well-known/security.txt");
  expect(txt.status()).toBe(200);
  expect(txt.headers()["content-type"]).toContain("text/plain");
  expect(txt.headers()["content-security-policy"]).toBeTruthy();
  expect(txt.headers()["x-content-type-options"]).toBe("nosniff");
  const body = await txt.text();
  expect(body).toContain("Contact: mailto:seguranca@exemplo.com");
  expect(body).toMatch(/Expires: \d{4}-\d{2}-\d{2}T/);

  // O link da propria tela de Configuracoes abre o arquivo
  await expect(page.getByRole("link", { name: "/.well-known/security.txt" })).toHaveAttribute("href", "/.well-known/security.txt");

  await openSecurity(page);
  await expect(page.getByRole("link", { name: "seguranca@exemplo.com" })).toHaveAttribute("href", "mailto:seguranca@exemplo.com");
});

test("contato invalido e recusado na tela e nada muda", async ({ page, request }) => {
  await loginAndWaitForDashboard(page);
  await openSettings(page, "Administração");
  await saveContact(page, "http://exemplo.com/contato");
  await expect(page.getByText("Informe um e-mail válido ou um endereço que comece com https://.")).toBeVisible();
  const body = await (await request.get("/.well-known/security.txt")).text();
  expect(body).toContain("mailto:seguranca@exemplo.com");
});

test("trocar por um endereco https muda o security.txt", async ({ page, request }) => {
  await loginAndWaitForDashboard(page);
  await openSettings(page, "Administração");
  await saveContact(page, "https://exemplo.com/contato-de-seguranca");
  await expect(page.getByText("Contato salvo.")).toBeVisible();
  const body = await (await request.get("/.well-known/security.txt")).text();
  expect(body).toContain("Contact: https://exemplo.com/contato-de-seguranca");
  expect(body).not.toContain("mailto:");

  await openSecurity(page);
  await expect(page.getByRole("link", { name: "https://exemplo.com/contato-de-seguranca" })).toHaveAttribute(
    "href",
    "https://exemplo.com/contato-de-seguranca",
  );
});

test("remover o contato apaga o security.txt e some da pagina Seguranca", async ({ page, request }) => {
  await loginAndWaitForDashboard(page);
  await openSettings(page, "Administração");
  await page.getByRole("button", { name: "Remover contato" }).click();
  await expect(page.getByText("Contato removido.")).toBeVisible();
  await expect(field(page, "Contato de segurança")).toHaveValue("");

  expect((await request.get("/.well-known/security.txt")).status()).toBe(404);
  await openSecurity(page);
  await expect(page.getByRole("heading", { level: 2, name: "Verificação em duas etapas" })).toBeVisible();
  await expect(page.getByText(/relatar um problema de segurança/)).toHaveCount(0);
});
