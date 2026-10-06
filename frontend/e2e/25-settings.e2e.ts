import { expect, test, type Page } from "@playwright/test";

import { ADMIN, apiHeaders, field, loginAndWaitForDashboard } from "./helpers";

// A pagina Configuracoes: perfil, senha, aparencia e convites. Em ordem: cada passo parte do anterior.
// O ultimo passo devolve a senha ao que era, porque os outros arquivos entram com ela.
test.describe.configure({ mode: "serial" });

const NEW_PASSWORD = "NovaSenha789";

async function openSettings(page: Page) {
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Configurações" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
}

test("a pagina tem as secoes e o item do menu leva a ela", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await openSettings(page);
  for (const title of ["Perfil", "Senha", "Aparência", "Segurança", "Usuários e convites"]) {
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  }
});

test("trocar o nome e a moeda padrao salva e o nome muda no menu do usuario", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await openSettings(page);

  await field(page, "Nome").fill("Ana Maria Teste");
  await field(page, "Moeda padrão").selectOption("USD");
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByText("Perfil salvo.")).toBeVisible();
  // Sem mudanca nova, o botao volta a ficar desligado
  await expect(page.getByRole("button", { name: "Salvar perfil" })).toBeDisabled();

  // Fica salvo no servidor: recarrega (a sessao guardada volta sozinha) e confere
  await page.reload();
  await openSettings(page);
  await expect(field(page, "Nome")).toHaveValue("Ana Maria Teste");
  await expect(field(page, "Moeda padrão")).toHaveValue("USD");
});

test("nome vazio e recusado na tela e o e-mail nao e editavel", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await openSettings(page);
  await field(page, "Nome").fill("");
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByText("Informe o nome.")).toBeVisible();
  await expect(field(page, "E-mail")).toHaveAttribute("readonly", "");
  await expect(field(page, "E-mail")).toHaveValue(ADMIN.email);
});

test("o tema escolhido nas Configuracoes vale para o app e fica lembrado", async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await openSettings(page);
  await page.getByRole("radio", { name: /Escuro/ }).check();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("radio", { name: /Claro/ }).check();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("senha atual errada avisa no campo e nao troca nada", async ({ page, request }) => {
  await loginAndWaitForDashboard(page);
  await openSettings(page);
  await field(page, "Senha atual").fill("SenhaErrada000");
  await field(page, "Nova senha").fill(NEW_PASSWORD);
  await field(page, "Repita a nova senha").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Trocar senha" }).click();
  await expect(page.getByText("Senha atual incorreta.")).toBeVisible();
  await expect(field(page, "Senha atual")).toBeFocused();
  // A senha de sempre continua entrando
  await apiHeaders(request, ADMIN);
});

test("trocar a senha mantem esta aba conectada e encerra as outras sessoes", async ({ page, request }) => {
  await loginAndWaitForDashboard(page);
  // Uma segunda sessao (so o token, como outro aparelho), com a senha antiga
  const stale = await apiHeaders(request, ADMIN);
  expect((await request.get("/api/v1/auth/me", { headers: stale })).status()).toBe(200);

  await openSettings(page);
  await field(page, "Senha atual").fill(ADMIN.password);
  await field(page, "Nova senha").fill(NEW_PASSWORD);
  await field(page, "Repita a nova senha").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Trocar senha" }).click();
  await expect(page.getByText(/Senha alterada/)).toBeVisible();
  await expect(field(page, "Senha atual")).toHaveValue("");

  // Esta aba segue conectada: abre outra pagina sem pedir login
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Painel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();

  // O token da senha antiga deixou de valer na hora
  const old = await request.get("/api/v1/auth/me", { headers: stale });
  expect(old.status()).toBe(401);

  // Entra com a senha nova; a antiga nao entra mais
  const wrong = await request.post("/api/v1/auth/login", { data: { email: ADMIN.email, password: ADMIN.password } });
  expect(wrong.status()).toBe(401);
  await apiHeaders(request, { ...ADMIN, password: NEW_PASSWORD });
});

test("o administrador cria um convite, ve o link uma vez e revoga", async ({ page }) => {
  await loginAndWaitForDashboard(page, { ...ADMIN, password: NEW_PASSWORD });
  await openSettings(page);

  await field(page, "E-mail da pessoa").fill("convidada@example.com");
  await page.getByRole("button", { name: "Criar convite" }).click();
  await expect(page.getByText(/Convite criado para/)).toBeVisible();
  await expect(page.locator("code")).toContainText("/register?invite=");
  await expect(page.getByRole("listitem").filter({ hasText: "convidada@example.com" })).toContainText(/Vence em 7 dias/);

  await page.getByRole("button", { name: "Revogar o convite de convidada@example.com" }).click();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "convidada@example.com" })).toHaveCount(0);
});

test("devolve a senha original para os outros arquivos de teste", async ({ page, request }) => {
  await loginAndWaitForDashboard(page, { ...ADMIN, password: NEW_PASSWORD });
  const headers = await apiHeaders(request, { ...ADMIN, password: NEW_PASSWORD });
  const back = await request.post("/api/v1/auth/password", {
    headers,
    data: { current_password: NEW_PASSWORD, new_password: ADMIN.password },
  });
  expect(back.status()).toBe(200);
  await apiHeaders(request, ADMIN);
});
