import { expect, test } from "@playwright/test";

import { ADMIN, field, GUEST, login, loginAndWaitForDashboard } from "./helpers";

// Os testes rodam em ordem contra o mesmo banco: o primeiro cria o administrador
test.describe.configure({ mode: "serial" });

test("primeiro acesso leva ao cadastro do administrador e entra no painel", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("heading", { name: "Criar conta de administrador" })).toBeVisible();
  await expect(page.getByLabel("Código do convite")).toHaveCount(0);

  await field(page, "Nome").fill(ADMIN.name);
  await field(page, "E-mail").fill(ADMIN.email);
  await field(page, "Senha").fill(ADMIN.password);
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
  await expect(page.getByText("Olá, Ana.")).toBeVisible();
});

test("depois do primeiro usuario, o login e a porta de entrada", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
});

test("recarregar a pagina pede login de novo e nao deixa token no navegador", async ({ page }) => {
  await loginAndWaitForDashboard(page);

  await page.reload();

  await expect(page).toHaveURL(/\/login/);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain("eyJ"); // prefixo de todo JWT
});

test("senha errada mostra a mensagem de erro e continua no login", async ({ page }) => {
  await page.goto("/login");
  await login(page, { email: ADMIN.email, password: "SenhaErrada999" });

  await expect(page.getByRole("alert")).toHaveText("E-mail ou senha incorretos.");
  await expect(page).toHaveURL(/\/login$/);
});

test("campos vazios mostram os erros sem chamar o servidor", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByText("Informe o e-mail.")).toBeVisible();
  await expect(page.getByText("Informe a senha.")).toBeVisible();
  await expect(field(page, "E-mail")).toBeFocused();
});

test("link direto para uma pagina interna volta para ela depois de entrar", async ({ page }) => {
  await page.goto("/contas");
  await expect(page).toHaveURL(/\/login\?next=%2Fcontas$/);

  await login(page, ADMIN);

  await expect(page).toHaveURL("/contas");
  await expect(page.getByRole("heading", { level: 1, name: "Página não encontrada" })).toBeVisible();
});

test("?next= para outro site nunca leva para fora do app", async ({ page }) => {
  await page.goto(`/login?next=${encodeURIComponent("//evil.example")}`);
  await login(page, ADMIN);

  // toHaveURL("/") compara com baseURL + "/": se tivesse ido para evil.example, falharia
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
});

test("sair leva de volta para o login e fecha o acesso", async ({ page }) => {
  await loginAndWaitForDashboard(page);

  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await expect(page.getByText(ADMIN.email)).toBeVisible();
  await page.getByRole("menuitem", { name: "Sair" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("convite: o admin convida, o link preenche o codigo e o convidado entra sem ser admin", async ({
  page,
  request,
}) => {
  const adminLogin = await request.post("/api/v1/auth/login", {
    data: { email: ADMIN.email, password: ADMIN.password },
  });
  const { access_token: adminToken } = await adminLogin.json();
  const invite = await request.post("/api/v1/invites", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { email: GUEST.email },
  });
  expect(invite.status()).toBe(201);
  const { token } = await invite.json();

  await page.goto(`/register?invite=${token}`);
  await expect(page.getByRole("heading", { name: "Criar conta", exact: true })).toBeVisible();
  await expect(field(page, "Código do convite")).toHaveValue(token);

  await field(page, "Nome").fill(GUEST.name);
  await field(page, "E-mail").fill(GUEST.email);
  await field(page, "Senha").fill(GUEST.password);
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page.getByText("Olá, Bruno.")).toBeVisible();

  const guestLogin = await request.post("/api/v1/auth/login", {
    data: { email: GUEST.email, password: GUEST.password },
  });
  const { access_token: guestToken } = await guestLogin.json();
  const me = await request.get("/api/v1/auth/me", { headers: { Authorization: `Bearer ${guestToken}` } });
  expect((await me.json()).is_admin).toBe(false);

  // O mesmo convite nao funciona duas vezes
  const reuse = await request.post("/api/v1/auth/register", {
    data: { name: "Outro", email: GUEST.email, password: GUEST.password, invite_token: token },
  });
  expect(reuse.status()).toBe(403);
});

test("cadastro sem convite valido mostra o erro", async ({ page }) => {
  await page.goto("/register?invite=codigo-que-nao-existe");
  await field(page, "Nome").fill("Carla");
  await field(page, "E-mail").fill("carla@example.com");
  await field(page, "Senha").fill("SenhaForte123");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page.getByRole("alert")).toHaveText("Convite inválido ou expirado.");
});

test.describe("celular", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("a gaveta do menu abre, navega e fecha", async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await expect(page.getByRole("link", { name: "Painel" })).toBeHidden();

    await page.getByRole("button", { name: "Abrir menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await expect(drawer).toBeVisible();

    await drawer.getByRole("link", { name: "Painel" }).click();
    await expect(drawer).toBeHidden();

    await page.getByRole("button", { name: "Abrir menu" }).click();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("button", { name: "Abrir menu" })).toBeFocused();
  });
});

test("o tema escolhido continua depois de recarregar", async ({ page }) => {
  await page.goto("/login");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);

  await page.getByRole("button", { name: "Mudar para o tema escuro" }).click();
  await expect(html).toHaveClass(/dark/);

  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Mudar para o tema claro" })).toBeVisible();
});
