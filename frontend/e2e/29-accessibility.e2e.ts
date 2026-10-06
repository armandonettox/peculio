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
  "/seguranca",
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
