import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it } from "vitest";

import { PublicOnlyRoute } from "@/components/protected-route";
import { LocationProbe } from "@/test-utils/location-probe";
import { sampleUser, server } from "@/test-utils/msw";
import { AppProviders } from "@/test-utils/providers";
import RegisterPage from "./register";

const status = (setupRequired: boolean) =>
  http.get("*/api/v1/auth/status", () => HttpResponse.json({ setup_required: setupRequired }));
const loginOk = () =>
  http.post("*/api/v1/auth/login", () => HttpResponse.json({ access_token: "tok", token_type: "bearer" }));
const meOk = () => http.get("*/api/v1/auth/me", () => HttpResponse.json(sampleUser));

function registerHandler(capture: { body?: Record<string, unknown>; calls: number }) {
  return http.post("*/api/v1/auth/register", async ({ request }) => {
    capture.calls += 1;
    capture.body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(sampleUser, { status: 201 });
  });
}

function registerFails(code: string, httpStatus: number, extra: Record<string, unknown> = {}) {
  return http.post("*/api/v1/auth/register", () =>
    HttpResponse.json({ detail: "x", code, ...extra }, { status: httpStatus }),
  );
}

function renderRegister(path = "/register") {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login" element={<p>Tela de login</p>} />
          </Route>
          <Route path="/" element={<p>Painel logado</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </AppProviders>,
  );
}

const nameField = () => screen.getByLabelText("Nome");
const emailField = () => screen.getByLabelText("E-mail");
const passwordField = () => screen.getByLabelText("Senha");
const inviteField = () => screen.getByLabelText("Código do convite");
const submit = () => screen.getByRole("button", { name: /Criar conta$|Criando conta/ });

async function fill({ name = "Ana Teste", email = "ana@example.com", password = "SenhaForte123", invite = "" } = {}) {
  await userEvent.type(nameField(), name);
  await userEvent.type(emailField(), email);
  await userEvent.type(passwordField(), password);
  if (invite) await userEvent.type(inviteField(), invite);
}

it("primeiro acesso: pede conta de administrador e nao mostra o campo de convite", async () => {
  server.use(status(true));
  renderRegister();
  expect(await screen.findByRole("heading", { name: "Criar conta de administrador" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Código do convite")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Entrar" })).not.toBeInTheDocument();
});

it("com usuarios na instancia: pede o convite e oferece o link para entrar", async () => {
  server.use(status(false));
  renderRegister();
  expect(await screen.findByRole("heading", { name: "Criar conta" })).toBeInTheDocument();
  expect(inviteField()).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/login");
});

it("enquanto verifica a instancia mostra um aviso de carregamento", () => {
  server.use(http.get("*/api/v1/auth/status", () => new Promise(() => undefined)));
  renderRegister();
  // role="status" avisa leitores de tela; o texto e o que o usuario ve
  expect(screen.getByText("Verificando a instância...")).toHaveAttribute("role", "status");
});

it("o link de convite preenche o campo do codigo", async () => {
  server.use(status(false));
  renderRegister("/register?invite=abc123");
  await screen.findByRole("heading", { name: "Criar conta" });
  expect(inviteField()).toHaveValue("abc123");
});

it("mostra a dica de tamanho minimo da senha", async () => {
  server.use(status(true));
  renderRegister();
  await screen.findByRole("heading", { name: /Criar conta/ });
  expect(passwordField()).toHaveAccessibleDescription("Mínimo de 8 caracteres.");
});

it("formulario vazio mostra todos os erros, foca o primeiro e nao chama a API", async () => {
  const capture = { calls: 0 } as { body?: Record<string, unknown>; calls: number };
  server.use(status(false), registerHandler(capture));
  renderRegister();
  await screen.findByRole("heading", { name: "Criar conta" });

  await userEvent.click(submit());

  expect(screen.getByText("Informe seu nome.")).toBeInTheDocument();
  expect(screen.getByText("Informe o e-mail.")).toBeInTheDocument();
  expect(screen.getByText(/pelo menos 8 caracteres/, { selector: "p.text-destructive" })).toBeInTheDocument();
  expect(screen.getByText("Informe o código do convite.")).toBeInTheDocument();
  expect(nameField()).toHaveFocus();
  expect(capture.calls).toBe(0);
});

it("erro do servidor num campo some quando o usuario volta a digitar nele", async () => {
  server.use(status(true), registerFails("email_already_registered", 400));
  renderRegister();
  await screen.findByRole("heading", { name: /Criar conta/ });
  await fill();
  await userEvent.click(submit());
  expect(await screen.findByText("Este e-mail já está cadastrado.")).toBeInTheDocument();

  await userEvent.type(emailField(), "x");

  expect(screen.queryByText("Este e-mail já está cadastrado.")).not.toBeInTheDocument();
});

it("senha curta e recusada antes de enviar", async () => {
  server.use(status(true));
  renderRegister();
  await screen.findByRole("heading", { name: /Criar conta/ });
  await fill({ password: "curta" });
  await userEvent.click(submit());
  expect(screen.getByText(/pelo menos 8 caracteres/, { selector: "p.text-destructive" })).toBeInTheDocument();
  expect(passwordField()).toHaveFocus();
});

it("primeiro administrador: cadastra sem convite, entra e vai para o painel", async () => {
  const capture = { calls: 0 } as { body?: Record<string, unknown>; calls: number };
  server.use(status(true), registerHandler(capture), loginOk(), meOk());
  renderRegister();
  await screen.findByRole("heading", { name: "Criar conta de administrador" });

  await fill();
  await userEvent.click(submit());

  expect(await screen.findByText("Painel logado")).toBeInTheDocument();
  expect(capture.body).toEqual({
    name: "Ana Teste",
    email: "ana@example.com",
    password: "SenhaForte123",
    invite_token: null,
  });
});

it("com convite: envia o codigo e entra", async () => {
  const capture = { calls: 0 } as { body?: Record<string, unknown>; calls: number };
  server.use(status(false), registerHandler(capture), loginOk(), meOk());
  renderRegister("/register?invite=conv-123");
  await screen.findByRole("heading", { name: "Criar conta" });

  await fill();
  await userEvent.click(submit());

  expect(await screen.findByText("Painel logado")).toBeInTheDocument();
  expect(capture.body?.invite_token).toBe("conv-123");
});

it("erros de campo do servidor (422) aparecem embaixo de cada campo", async () => {
  server.use(
    status(true),
    registerFails("validation_error", 422, {
      errors: [
        { field: "password", message: "Senha deve ter pelo menos 8 caracteres" },
        { field: "name", message: "Nome muito longo" },
      ],
    }),
  );
  renderRegister();
  await screen.findByRole("heading", { name: /Criar conta/ });
  await fill();
  await userEvent.click(submit());

  expect(await screen.findByText("Senha deve ter pelo menos 8 caracteres")).toBeInTheDocument();
  expect(screen.getByText("Nome muito longo")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Confira os dados informados.");
  expect(nameField()).toHaveFocus();
});

it("erro do campo invite_token do servidor aparece no campo do convite", async () => {
  server.use(
    status(false),
    registerFails("validation_error", 422, { errors: [{ field: "invite_token", message: "Convite com formato errado" }] }),
  );
  renderRegister("/register?invite=x");
  await screen.findByRole("heading", { name: "Criar conta" });
  await fill();
  await userEvent.click(submit());
  expect(await screen.findByText("Convite com formato errado")).toBeInTheDocument();
  expect(inviteField()).toHaveAccessibleDescription("Convite com formato errado");
});

it("e-mail repetido aparece como erro do campo de e-mail", async () => {
  server.use(status(true), registerFails("email_already_registered", 400));
  renderRegister();
  await screen.findByRole("heading", { name: /Criar conta/ });
  await fill();
  await userEvent.click(submit());

  expect(await screen.findByText("Este e-mail já está cadastrado.")).toBeInTheDocument();
  expect(emailField()).toHaveAttribute("aria-invalid", "true");
  expect(emailField()).toHaveFocus();
});

it("convite invalido mostra o aviso e libera o botao", async () => {
  server.use(status(false), registerFails("invite_invalid", 403));
  renderRegister("/register?invite=ruim");
  await screen.findByRole("heading", { name: "Criar conta" });
  await fill();
  await userEvent.click(submit());

  expect(await screen.findByRole("alert")).toHaveTextContent("Convite inválido ou expirado.");
  expect(submit()).toBeEnabled();
});

it("erro ao consultar a instancia mostra aviso e permite tentar de novo", async () => {
  let calls = 0;
  server.use(
    http.get("*/api/v1/auth/status", () => {
      calls += 1;
      if (calls === 1) return HttpResponse.json({ detail: "x", code: "internal_error" }, { status: 500 });
      return HttpResponse.json({ setup_required: true });
    }),
  );
  renderRegister();

  expect(await screen.findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

  expect(await screen.findByRole("heading", { name: "Criar conta de administrador" })).toBeInTheDocument();
});

it("o botao fica desabilitado enquanto cria a conta", async () => {
  const { delay } = await import("msw");
  server.use(
    status(true),
    http.post("*/api/v1/auth/register", async () => {
      await delay(60);
      return HttpResponse.json(sampleUser, { status: 201 });
    }),
    loginOk(),
    meOk(),
  );
  renderRegister();
  await screen.findByRole("heading", { name: /Criar conta/ });
  await fill();
  await userEvent.click(submit());

  expect(screen.getByRole("button", { name: "Criando conta..." })).toBeDisabled();
  await screen.findByText("Painel logado");
});
