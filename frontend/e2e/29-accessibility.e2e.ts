import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { loginAndWaitForDashboard } from "./helpers";

// Varredura de acessibilidade (axe-core, WCAG 2.2 AA mais as boas praticas) em todas as telas, nos dois temas e em dois
// tamanhos. Roda no fim: as telas ja tem os dados criados pelos arquivos anteriores. Um problema novo quebra o teste.

const ROUTES = [
  "/",
  "/contas",
  "/transacoes",
  "/importar",
  "/conciliar",
  "/categorias",
  "/tags",
  "/orcamentos",
  "/envelopes",
  "/contas-a-pagar",
  "/recorrentes",
  "/cofrinhos",
  "/regras",
  "/webhooks",
  "/relatorios",
  "/configuracoes",
  "/configuracoes?aba=aparencia",
  "/configuracoes?aba=seguranca",
  "/configuracoes?aba=administracao",
  "/rota-que-nao-existe",
];

const SIZES = {
  desktop: { width: 1280, height: 800 },
  celular: { width: 390, height: 800 },
} as const;

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function scan(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  // Espera a tela terminar de carregar (a primeira pintura mostra o esqueleto)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map(
    (violation) =>
      `${route} ${violation.id} (${violation.impact}): ${violation.help} | ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(" ; ")}`,
  );
}

for (const [sizeName, viewport] of Object.entries(SIZES)) {
  for (const theme of ["light", "dark"] as const) {
    test(`sem problemas de acessibilidade em todas as telas: ${sizeName}, tema ${theme}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext({ viewport, colorScheme: theme, locale: "pt-BR" });
      await context.addInitScript((value) => localStorage.setItem("peculio-theme", value), theme);
      const page = await context.newPage();
      await loginAndWaitForDashboard(page);

      const problems: string[] = [];
      for (const route of ROUTES) problems.push(...(await scan(page, route)));
      await context.close();

      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
}

// As telas publicas (sem login): entrar e criar conta
for (const [sizeName, viewport] of Object.entries(SIZES)) {
  for (const theme of ["light", "dark"] as const) {
    test(`sem problemas de acessibilidade nas telas publicas: ${sizeName}, tema ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, colorScheme: theme, locale: "pt-BR" });
      await context.addInitScript((value) => localStorage.setItem("peculio-theme", value), theme);
      const page = await context.newPage();

      const problems: string[] = [];
      for (const route of ["/login", "/register", "/register?invite=abc"]) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        problems.push(...result.violations.map((violation) => `${route} ${violation.id}: ${violation.help}`));
      }
      await context.close();

      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
}

// Diálogos de criar e de ações de cada tela, abertos. Com um diálogo aberto o Radix esconde a página de propósito
// (aria-hidden) e as regras de página inteira (main, h1, regiões) disparam por construção: por isso a varredura olha só o
// conteúdo do diálogo.
const DIALOGS: { route: string; opener: string; optional?: boolean }[] = [
  { route: "/contas", opener: "Nova conta" },
  { route: "/transacoes", opener: "Novo lançamento" },
  { route: "/categorias", opener: "Nova categoria" },
  { route: "/tags", opener: "Nova tag" },
  { route: "/orcamentos", opener: "Novo orçamento" },
  { route: "/envelopes", opener: "Novo envelope" },
  { route: "/envelopes", opener: "Mover dinheiro", optional: true },
  { route: "/envelopes", opener: "Aplicar templates", optional: true },
  { route: "/contas-a-pagar", opener: "Nova conta a pagar" },
  { route: "/recorrentes", opener: "Nova recorrente" },
  { route: "/cofrinhos", opener: "Novo cofrinho" },
  { route: "/regras", opener: "Nova regra" },
  { route: "/regras", opener: "Novo grupo" },
  { route: "/webhooks", opener: "Novo webhook" },
  { route: "/configuracoes?aba=seguranca", opener: "Criar token" },
  { route: "/configuracoes?aba=seguranca", opener: "Ativar verificação em duas etapas", optional: true },
];

for (const theme of ["light", "dark"] as const) {
  test(`sem problemas de acessibilidade nos dialogos abertos: tema ${theme}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ viewport: SIZES.desktop, colorScheme: theme, locale: "pt-BR" });
    await context.addInitScript((value) => localStorage.setItem("peculio-theme", value), theme);
    const page = await context.newPage();
    await loginAndWaitForDashboard(page);

    const problems: string[] = [];
    let scanned = 0;
    for (const { route, opener, optional } of DIALOGS) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Algumas telas tem dois botoes com o mesmo nome (o do cabecalho e o do estado vazio): vale o primeiro
      const button = page.getByRole("button", { name: opener, exact: true }).first();
      if (optional && (await button.count()) === 0) continue;
      await button.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const result = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .disableRules(["landmark-one-main", "page-has-heading-one", "region", "aria-hidden-focus"])
        .withTags(TAGS)
        .analyze();
      scanned += 1;
      problems.push(...result.violations.map((violation) => `${route} > ${opener}: ${violation.id}: ${violation.help}`));
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await context.close();

    // Garante que a varredura nao virou um teste vazio se os botoes mudarem de nome
    expect(scanned).toBeGreaterThanOrEqual(13);
    expect(problems, problems.join("\n")).toEqual([]);
  });
}

// Reflow (WCAG 1.4.10): a 320 px de largura (o equivalente a 400 % de zoom) a pagina nao pode ganhar rolagem horizontal.
// Tabelas largas rolam dentro da propria caixa; a pagina em si nao.
test("sem rolagem horizontal da pagina a 320 px, em todas as telas e nos dialogos de criar", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 320, height: 700 }, locale: "pt-BR" });
  const page = await context.newPage();
  await loginAndWaitForDashboard(page);

  const overflow = () =>
    page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });

  const problems: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const extra = await overflow();
    if (extra > 1) problems.push(`${route}: a pagina passa ${extra}px da largura`);
  }

  for (const { route, opener, optional } of DIALOGS) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const button = page.getByRole("button", { name: opener, exact: true }).first();
    if (optional && (await button.count()) === 0) continue;
    await button.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const sizes = await dialog.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    if (sizes.scroll - sizes.client > 1) problems.push(`${route} > ${opener}: o dialogo passa ${sizes.scroll - sizes.client}px da largura`);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  await context.close();

  expect(problems, problems.join("\n")).toEqual([]);
});

// Uso so pelo teclado: o primeiro Tab leva ao link de pular, o foco fica preso dentro de um dialogo aberto e volta ao botao
// que o abriu quando ele fecha.
test("teclado: o link de pular leva ao conteudo", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("teclado: o dialogo prende o foco e devolve ao botao ao fechar", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Contas", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contas" })).toBeVisible();

  const opener = page.getByRole("button", { name: "Nova conta", exact: true }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // O foco entra no dialogo e, por mais que se aperte Tab (ou Shift+Tab), nunca sai dele
  const insideDialog = () => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  expect(await insideDialog()).toBe(true);
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press("Tab");
    expect(await insideDialog(), `Tab ${i + 1} saiu do dialogo`).toBe(true);
  }
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await insideDialog(), `Shift+Tab ${i + 1} saiu do dialogo`).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("teclado: o menu do usuario abre, navega com as setas e fecha com Esc devolvendo o foco", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  const trigger = page.getByRole("button", { name: "Menu do usuário" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("menuitem");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
