import { expect, test, type Page } from "@playwright/test";

import { loginAndWaitForDashboard } from "./helpers";

// Os cabecalhos de seguranca do servidor e a politica de conteudo (CSP). A prova que importa: o app inteiro continua
// funcionando com a politica ligada, sem nenhuma violacao.
test.describe.configure({ mode: "serial" });

const REQUIRED = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
};

// Registra cada violacao da CSP que o navegador relatar na pagina
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
}

const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

test("cada tipo de resposta traz os cabecalhos de seguranca", async ({ request }) => {
  for (const path of ["/", "/login", "/sw.js", "/manifest.webmanifest", "/theme-init.js", "/api/health"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const headers = response.headers();
    for (const [name, value] of Object.entries(REQUIRED)) expect(headers[name], `${path} ${name}`).toBe(value);
    expect(headers["permissions-policy"], path).toContain("camera=()");
    expect(headers["content-security-policy"], path).toBeTruthy();
  }
  // Os arquivos com hash tambem, e seguem com o cache longo
  const page = await request.get("/");
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(await page.text())?.[1];
  expect(asset).toBeTruthy();
  const file = await request.get(asset!);
  expect(file.headers()["content-security-policy"]).toBeTruthy();
  expect(file.headers()["cache-control"]).toContain("immutable");
});

test("a politica fecha script de fora, iframe e objeto, e nao esconde a versao do servidor", async ({ request }) => {
  const response = await request.get("/");
  const csp = response.headers()["content-security-policy"];
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(response.headers()["server"] ?? "").not.toMatch(/\d/);
  // O cache continua valendo nas paginas que tem Cache-Control (o add_header de um location nao apaga o de outro)
  expect(response.headers()["cache-control"]).toBe("no-cache");
});

test("a pagina de login carrega sem nenhuma violacao da politica", async ({ page }) => {
  await watchViolations(page);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("o tema escuro escolhido vale antes do React, pelo script externo", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("peculio-theme", "dark"));
  await watchViolations(page);
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await violations(page)).toEqual([]);
});

test("o app inteiro funciona com a politica ligada", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) errors.push(message.text());
  });
  await watchViolations(page);
  await loginAndWaitForDashboard(page);

  // Telas com graficos, formularios, dialogos, tabelas e exportacao
  for (const [link, heading] of [
    ["Transações", "Transações"],
    ["Relatórios", "Relatórios"],
    ["Orçamentos", "Orçamentos"],
    ["Configurações", "Configurações"],
  ] as const) {
    await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  // Um dialogo (Radix injeta estilo) e o menu do usuario
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await page.keyboard.press("Escape");

  expect(await violations(page)).toEqual([]);
  expect(errors).toEqual([]);
});
