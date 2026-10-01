import { expect, test, type Page } from "@playwright/test";

import { ADMIN, loginAndWaitForDashboard } from "./helpers";

// Roda depois do 01-auth (que cria o administrador). Os testes seguem em ordem.
test.describe.configure({ mode: "serial" });

async function openPage(page: Page, menuLabel: "Categorias" | "Tags") {
  await loginAndWaitForDashboard(page);
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: menuLabel }).click();
  await expect(page.getByRole("heading", { level: 1, name: menuLabel })).toBeVisible();
}

const dialog = (page: Page, name: string | RegExp) => page.getByRole("dialog", { name });
const chip = (page: Page, name: string) => page.getByText(name, { exact: true }).locator("visible=true").first();
const rowMenu = (page: Page, name: string) => page.getByRole("button", { name: `Ações de ${name}` });

// Contraste (WCAG) entre o texto e o fundo do selo, calculado no navegador
async function chipContrast(page: Page, name: string): Promise<number> {
  // Espera o selo ter fundo pintado: logo apos criar, o elemento pode ainda estar "transparent"
  await expect(chip(page, name)).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  return chip(page, name).evaluate((element) => {
    const toRgb = (value: string) => value.match(/\d+/g)!.slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const style = getComputedStyle(element);
    const [a, b] = [lum(toRgb(style.backgroundColor)), lum(toRgb(style.color))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}

async function createCategory(page: Page, name: string, color?: string) {
  await page.getByRole("button", { name: "Nova categoria" }).first().click();
  const form = dialog(page, "Nova categoria");
  await form.getByLabel("Nome", { exact: true }).fill(name);
  if (color) await form.getByLabel("Cor", { exact: true }).fill(color);
  await form.getByRole("button", { name: "Criar" }).click();
}

test("o menu leva para Categorias e a lista comeca vazia", async ({ page }) => {
  await openPage(page, "Categorias");
  await expect(page).toHaveURL("/categorias");
  await expect(page.getByText("Nenhuma categoria ainda")).toBeVisible();
});

test("cria categorias com cores digitadas, de uma amostra e do seletor do navegador", async ({ page }) => {
  await openPage(page, "Categorias");

  await createCategory(page, "Mercado", "#e11d48");
  await expect(chip(page, "Mercado")).toHaveAttribute("data-color", "#E11D48");

  await page.getByRole("button", { name: "Nova categoria" }).first().click();
  let form = dialog(page, "Nova categoria");
  await form.getByLabel("Nome", { exact: true }).fill("Lazer");
  await form.getByRole("button", { name: "Usar a cor #8B5CF6" }).click();
  await form.getByRole("button", { name: "Criar" }).click();
  await expect(chip(page, "Lazer")).toHaveAttribute("data-color", "#8B5CF6");

  await page.getByRole("button", { name: "Nova categoria" }).first().click();
  form = dialog(page, "Nova categoria");
  await form.getByLabel("Nome", { exact: true }).fill("Viagem");
  await form.getByLabel("Escolher a cor no seletor").fill("#123abc");
  await form.getByRole("button", { name: "Criar" }).click();
  await expect(chip(page, "Viagem")).toHaveAttribute("data-color", "#123ABC");

  await createCategory(page, "Outros");
  await expect(chip(page, "Outros")).not.toHaveAttribute("data-color");
});

test("o texto continua legivel sobre qualquer cor, inclusive branco, preto e amarelo", async ({ page }) => {
  await openPage(page, "Categorias");
  for (const [name, color] of [
    ["Branca", "#FFFFFF"],
    ["Preta", "#000000"],
    ["Amarela", "#FFFF00"],
    ["Cinza", "#787878"],
  ]) {
    await createCategory(page, name, color);
    await expect(chip(page, name)).toHaveAttribute("data-color", color);
    expect(await chipContrast(page, name), `contraste em ${name}`).toBeGreaterThanOrEqual(4.5);
  }
});

test("a lista fica em ordem alfabetica e mostra a contagem", async ({ page }) => {
  await openPage(page, "Categorias");
  await expect(page.getByText(/^\d+ categorias$/)).toBeVisible();
  // So a lista da pagina: o menu lateral tambem tem itens de lista
  const names = await page.getByRole("main").getByRole("listitem").allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
});

test("os dados vem do banco: continuam la depois de entrar de novo, com a cor em maiusculas", async ({
  page,
  request,
}) => {
  await openPage(page, "Categorias");
  await expect(chip(page, "Mercado")).toHaveAttribute("data-color", "#E11D48");

  const login = await request.post("/api/v1/auth/login", { data: { email: ADMIN.email, password: ADMIN.password } });
  const { access_token: token } = await login.json();
  const list = await request.get("/api/v1/categories?q=merc", { headers: { Authorization: `Bearer ${token}` } });
  const { items } = await list.json();
  expect(items).toHaveLength(1);
  expect(items[0].color).toBe("#E11D48");
  expect((await request.get("/api/v1/categories")).status()).toBe(401);
});

test("nome repetido mostra o erro no campo, ignorando maiusculas", async ({ page }) => {
  await openPage(page, "Categorias");
  await createCategory(page, "mercado");
  const form = dialog(page, "Nova categoria");
  await expect(form.getByText("Já existe uma categoria com esse nome.")).toBeVisible();
  await expect(form.getByLabel("Nome", { exact: true })).toBeFocused();
  await form.getByRole("button", { name: "Cancelar" }).click();
});

test("cor invalida e recusada no formulario", async ({ page }) => {
  await openPage(page, "Categorias");
  await createCategory(page, "Teste", "azul");
  await expect(dialog(page, "Nova categoria").getByText("Use o formato #RRGGBB, por exemplo #1E3A6B.")).toBeVisible();
  await dialog(page, "Nova categoria").getByRole("button", { name: "Cancelar" }).click();
});

test("a busca filtra pelo nome e avisa quando nada e encontrado", async ({ page }) => {
  await openPage(page, "Categorias");
  await page.getByLabel("Buscar categoria").fill("merc");
  await expect(page.getByText("1 categoria com “merc”")).toBeVisible();
  await expect(chip(page, "Mercado")).toBeVisible();
  await expect(page.getByText("Lazer", { exact: true })).toHaveCount(0);

  await page.getByLabel("Buscar categoria").fill("zzzz");
  await expect(page.getByText("Nada encontrado")).toBeVisible();

  await page.getByLabel("Buscar categoria").fill("");
  await expect(chip(page, "Lazer")).toBeVisible();
});

test("edita o nome e a cor, e depois tira a cor", async ({ page }) => {
  await openPage(page, "Categorias");
  await rowMenu(page, "Viagem").click();
  await page.getByRole("menuitem", { name: "Editar" }).click();

  const form = dialog(page, "Editar categoria");
  await form.getByLabel("Nome", { exact: true }).fill("Viagens");
  await form.getByLabel("Cor", { exact: true }).fill("#00a878");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(chip(page, "Viagens")).toHaveAttribute("data-color", "#00A878");

  await rowMenu(page, "Viagens").click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await dialog(page, "Editar categoria").getByRole("button", { name: "Sem cor" }).click();
  await dialog(page, "Editar categoria").getByRole("button", { name: "Salvar" }).click();
  await expect(chip(page, "Viagens")).not.toHaveAttribute("data-color");
});

test("excluir pede confirmacao e remove a categoria", async ({ page }) => {
  await openPage(page, "Categorias");
  await rowMenu(page, "Outros").click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  await expect(dialog(page, "Excluir categoria")).toContainText("As transações dela ficarão sem categoria");
  await dialog(page, "Excluir categoria").getByRole("button", { name: "Cancelar" }).click();
  await expect(chip(page, "Outros")).toBeVisible();

  await rowMenu(page, "Outros").click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  await dialog(page, "Excluir categoria").getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("Outros", { exact: true })).toHaveCount(0);
});

test.describe("tags", () => {
  test("cria, busca, repete e renomeia", async ({ page }) => {
    await openPage(page, "Tags");
    await expect(page.getByText("Nenhuma tag ainda")).toBeVisible();

    for (const name of ["viagem", "reembolso", "casa"]) {
      await page.getByRole("button", { name: "Nova tag" }).first().click();
      await dialog(page, "Nova tag").getByLabel("Nome", { exact: true }).fill(name);
      await dialog(page, "Nova tag").getByRole("button", { name: "Criar" }).click();
      await expect(chip(page, name)).toBeVisible();
    }
    // Tag nao tem cor
    await page.getByRole("button", { name: "Nova tag" }).first().click();
    await expect(dialog(page, "Nova tag").getByLabel("Cor", { exact: true })).toHaveCount(0);
    await dialog(page, "Nova tag").getByLabel("Nome", { exact: true }).fill("VIAGEM");
    await dialog(page, "Nova tag").getByRole("button", { name: "Criar" }).click();
    await expect(dialog(page, "Nova tag").getByText("Já existe uma tag com esse nome.")).toBeVisible();
    await dialog(page, "Nova tag").getByRole("button", { name: "Cancelar" }).click();

    await page.getByLabel("Buscar tag").fill("reem");
    await expect(page.getByText("1 tag com “reem”")).toBeVisible();
    await page.getByLabel("Buscar tag").fill("");

    await rowMenu(page, "casa").click();
    await page.getByRole("menuitem", { name: "Editar" }).click();
    await dialog(page, "Editar tag").getByLabel("Nome", { exact: true }).fill("moradia");
    await dialog(page, "Editar tag").getByRole("button", { name: "Salvar" }).click();
    await expect(chip(page, "moradia")).toBeVisible();
    await expect(page.getByText("casa", { exact: true })).toHaveCount(0);
  });

  test("categoria e tag podem ter o mesmo nome (espacos separados)", async ({ page }) => {
    await openPage(page, "Tags");
    await page.getByRole("button", { name: "Nova tag" }).first().click();
    await dialog(page, "Nova tag").getByLabel("Nome", { exact: true }).fill("Lazer");
    await dialog(page, "Nova tag").getByRole("button", { name: "Criar" }).click();
    await expect(chip(page, "Lazer")).toBeVisible();
  });

  test("excluir remove a tag", async ({ page }) => {
    await openPage(page, "Tags");
    await rowMenu(page, "moradia").click();
    await page.getByRole("menuitem", { name: "Excluir" }).click();
    await expect(dialog(page, "Excluir tag")).toContainText("Ela será removida das transações que a usam");
    await dialog(page, "Excluir tag").getByRole("button", { name: "Excluir" }).click();
    await expect(page.getByText("moradia", { exact: true })).toHaveCount(0);
  });
});

test("no celular o formulario de categoria cabe na tela", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await loginAndWaitForDashboard(page);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Categorias" }).click();
  await page.getByRole("button", { name: "Nova categoria" }).first().click();
  const box = await dialog(page, "Nova categoria").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await dialog(page, "Nova categoria").getByRole("button", { name: "Cancelar" }).click();
});
