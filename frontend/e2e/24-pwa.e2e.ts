import { expect, test, type Page } from "@playwright/test";

import { loginAndWaitForDashboard } from "./helpers";

// O app instalavel (PWA): manifesto, icones, service worker e o que acontece sem rede. Em ordem: cada passo parte do anterior.
// Roda no endereco do E2E (localhost conta como seguro, entao o service worker funciona sem HTTPS).
test.describe.configure({ mode: "serial" });

async function openLogin(page: Page) {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
}

// Espera o service worker assumir a pagina (ele registra depois do carregamento e assume ao ativar)
async function waitForWorker(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return Boolean(registration?.active) && navigator.serviceWorker.controller !== null;
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
}

test("o manifesto descreve o app e os icones existem", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("manifest+json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: "Pecúlio", start_url: "/", scope: "/", display: "standalone", lang: "pt-BR", theme_color: "#1e3a6b" });

  const sizes = manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes}:${icon.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const icon of manifest.icons as { src: string; type: string }[]) {
    const file = await request.get(icon.src);
    expect(file.status(), icon.src).toBe(200);
    expect(file.headers()["content-type"]).toContain(icon.type);
  }
});

test("a pagina aponta para o manifesto, os icones e a cor da barra do sistema", async ({ page }) => {
  await openLogin(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#1e3a6b");
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
});

test("o servidor deixa o service worker e o manifesto sem cache, e os arquivos com hash em cache longo", async ({ page, request }) => {
  expect((await request.get("/sw.js")).headers()["cache-control"]).toBe("no-cache");
  expect((await request.get("/manifest.webmanifest")).headers()["cache-control"]).toBe("no-cache");
  expect((await request.get("/")).headers()["cache-control"]).toBe("no-cache");
  await openLogin(page);
  const asset = await page.locator('script[src^="/assets/"]').first().getAttribute("src");
  expect((await request.get(asset!)).headers()["cache-control"]).toContain("immutable");
  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["content-type"]).toContain("javascript");
});

test("o service worker registra, guarda a casca e nunca a API", async ({ page }) => {
  await openLogin(page);
  await waitForWorker(page);

  const registration = await page.evaluate(async () => {
    const found = await navigator.serviceWorker.getRegistration();
    return { script: found?.active?.scriptURL ?? "", scope: found?.scope ?? "" };
  });
  expect(registration.script.endsWith("/sw.js")).toBe(true);
  expect(registration.scope.endsWith("/")).toBe(true);

  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("peculio-shell-"));
    const paths: string[] = [];
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
    }
    return { names, paths };
  });
  expect(cached.names).toHaveLength(1);
  expect(cached.paths).toContain("/");
  expect(cached.paths).toContain("/manifest.webmanifest");
  expect(cached.paths.some((path) => path.startsWith("/assets/") && path.endsWith(".js"))).toBe(true);
  expect(cached.paths.some((path) => path.startsWith("/assets/") && path.endsWith(".css"))).toBe(true);
  expect(cached.paths.some((path) => path.startsWith("/api"))).toBe(false);
});

test("depois de entrar e navegar, nenhuma resposta da API fica guardada", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Transações" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Transações" })).toBeVisible();
  await waitForWorker(page);
  const apiPaths = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
    }
    return paths.filter((path) => path.startsWith("/api"));
  });
  expect(apiPaths).toEqual([]);
});

test("sem rede: o app abre, avisa, serve a casca do cache e nao inventa dados da API", async ({ page, context }) => {
  await openLogin(page);
  await waitForWorker(page);
  const asset = (await page.locator('script[src^="/assets/"]').first().getAttribute("src"))!;

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Sem conexão" })).toBeVisible();

  // Um arquivo da casca ainda sai do cache; a API nunca: sem rede, falha de verdade
  const outcome = await page.evaluate(async (path) => {
    const shell = await fetch(path).then((response) => response.status, () => "falhou");
    const api = await fetch("/api/v1/auth/status").then((response) => response.status, () => "falhou");
    return { shell, api };
  }, asset);
  expect(outcome).toEqual({ shell: 200, api: "falhou" });

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "Sem conexão" })).toHaveCount(0);
});

test("o login sem rede mostra o erro de conexao e a tela continua utilizavel", async ({ page, context }) => {
  await openLogin(page);
  await waitForWorker(page);
  await context.setOffline(true);
  await page.getByLabel("E-mail", { exact: true }).fill("ana@example.com");
  await page.getByLabel("Senha", { exact: true }).fill("SenhaForte123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled();
  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "Sem conexão" })).toHaveCount(0);
});
