import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it } from "vitest";

import { PublicOnlyRoute } from "@/components/protected-route";
import { LocationProbe } from "@/test-utils/location-probe";
import { sampleUser, server } from "@/test-utils/msw";
import { AppProviders } from "@/test-utils/providers";
import LoginPage from "./login";

const status = (setupRequired = false) =>
  http.get("*/api/v1/auth/status", () => HttpResponse.json({ setup_required: setupRequired }));
const loginOk = () =>
  http.post("*/api/v1/auth/login", () => HttpResponse.json({ access_token: "tok", token_type: "bearer" }));
const meOk = () => http.get("*/api/v1/auth/me", () => HttpResponse.json(sampleUser));
const loginFails = (code: string, httpStatus: number) =>
  http.post("*/api/v1/auth/login", () => HttpResponse.json({ detail: "x", code }, { status: httpStatus }));

function renderLogin(path = "/login") {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<p>Tela de cadastro</p>} />
          </Route>
          <Route path="/" element={<p>Painel logado</p>} />
          <Route path="/contas" element={<p>Pagina de contas</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </AppProviders>,
  );
}

const emailField = () => screen.getByLabelText("E-mail");
const passwordField = () => screen.getByLabelText("Senha");
const submit = () => screen.getByRole("button", { name: /Entrar|Entrando/ });

async function fillAndSubmit(email = "ana@example.com", password = "SenhaForte123") {
  await userEvent.type(emailField(), email);
  await userEvent.type(passwordField(), password);
  await userEvent.click(submit());
}

it("mostra o formulario de entrada", async () => {
  server.use(status());
  renderLogin();
  expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  expect(emailField()).toHaveAttribute("type", "email");
  expect(passwordField()).toHaveAttribute("type", "password");
  expect(screen.getByRole("link", { name: "Criar conta" })).toHaveAttribute("href", "/register");
});

it("campos vazios mostram os erros, focam o primeiro e nao chamam a API", async () => {
  let loginCalls = 0;
  server.use(
    status(),
    http.post("*/api/v1/auth/login", () => {
      loginCalls += 1;
      return HttpResponse.json({ access_token: "tok", token_type: "bearer" });
    }),
  );
  renderLogin();

  await userEvent.click(submit());

  expect(screen.getByText("Informe o e-mail.")).toBeInTheDocument();
  expect(screen.getByText("Informe a senha.")).toBeInTheDocument();
  expect(emailField()).toHaveFocus();
  expect(emailField()).toHaveAttribute("aria-invalid", "true");
  expect(emailField()).toHaveAccessibleDescription("Informe o e-mail.");
  expect(loginCalls).toBe(0);
});

it("o erro de um campo some quando o usuario volta a digitar nele, e so dele", async () => {
  server.use(status());
  renderLogin();
  await userEvent.click(submit());
  expect(screen.getByText("Informe o e-mail.")).toBeInTheDocument();
  expect(screen.getByText("Informe a senha.")).toBeInTheDocument();

  await userEvent.type(emailField(), "a");

  expect(screen.queryByText("Informe o e-mail.")).not.toBeInTheDocument();
  expect(emailField()).toHaveAttribute("aria-invalid", "false");
  expect(screen.getByText("Informe a senha.")).toBeInTheDocument();
});

it("e-mail em formato invalido e recusado antes de enviar", async () => {
  server.use(status());
  renderLogin();
  await userEvent.type(emailField(), "ana-sem-arroba");
  await userEvent.type(passwordField(), "qualquer");
  await userEvent.click(submit());
  expect(screen.getByText("Informe um e-mail válido.")).toBeInTheDocument();
});

it("login certo leva para o painel", async () => {
  server.use(status(), loginOk(), meOk());
  renderLogin();
  await fillAndSubmit();
  expect(await screen.findByText("Painel logado")).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
});

it("login certo com ?next= volta para onde o usuario queria ir", async () => {
  server.use(status(), loginOk(), meOk());
  renderLogin("/login?next=%2Fcontas");
  await fillAndSubmit();
  expect(await screen.findByText("Pagina de contas")).toBeInTheDocument();
});

it("login certo com ?next= para outro site cai no painel", async () => {
  server.use(status(), loginOk(), meOk());
  renderLogin(`/login?next=${encodeURIComponent("//evil.com")}`);
  await fillAndSubmit();
  expect(await screen.findByText("Painel logado")).toBeInTheDocument();
});

it("envia o e-mail sem espacos nas pontas", async () => {
  let sent: Record<string, unknown> = {};
  server.use(
    status(),
    http.post("*/api/v1/auth/login", async ({ request }) => {
      sent = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ access_token: "tok", token_type: "bearer" });
    }),
    meOk(),
  );
  renderLogin();
  await fillAndSubmit("  ana@example.com  ", "SenhaForte123");
  await screen.findByText("Painel logado");
  expect(sent).toEqual({ email: "ana@example.com", password: "SenhaForte123" });
});

it.each([
  ["invalid_credentials", 401, "E-mail ou senha incorretos."],
  ["account_locked", 423, "Conta bloqueada por excesso de tentativas. Tente de novo em alguns minutos."],
  ["rate_limited", 429, "Muitas tentativas. Aguarde um instante e tente de novo."],
  ["internal_error", 500, "Algo deu errado do nosso lado. Tente novamente."],
])("erro %s mostra a mensagem em portugues e libera o botao", async (code, httpStatus, message) => {
  server.use(status(), loginFails(code, httpStatus));
  renderLogin();
  await fillAndSubmit();

  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(submit()).toBeEnabled();
  expect(screen.getByTestId("location")).toHaveTextContent("/login");
});

it("falha de rede mostra aviso de conexao", async () => {
  server.use(status(), http.post("*/api/v1/auth/login", () => HttpResponse.error()));
  renderLogin();
  await fillAndSubmit();
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível conectar ao servidor");
});

it("o botao fica desabilitado e muda o texto enquanto envia", async () => {
  server.use(
    status(),
    http.post("*/api/v1/auth/login", async () => {
      await delay(60);
      return HttpResponse.json({ access_token: "tok", token_type: "bearer" });
    }),
    meOk(),
  );
  renderLogin();
  await fillAndSubmit();

  expect(screen.getByRole("button", { name: "Entrando..." })).toBeDisabled();
  await screen.findByText("Painel logado");
});

it("clique duplo no botao envia so um pedido", async () => {
  let loginCalls = 0;
  server.use(
    status(),
    http.post("*/api/v1/auth/login", async () => {
      loginCalls += 1;
      await delay(40);
      return HttpResponse.json({ access_token: "tok", token_type: "bearer" });
    }),
    meOk(),
  );
  renderLogin();
  await userEvent.type(emailField(), "ana@example.com");
  await userEvent.type(passwordField(), "SenhaForte123");
  await userEvent.dblClick(submit());
  await screen.findByText("Painel logado");
  expect(loginCalls).toBe(1);
});

it("instancia sem usuarios leva para o cadastro do administrador", async () => {
  server.use(status(true));
  renderLogin();
  expect(await screen.findByText("Tela de cadastro")).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent("/register");
});

it("falha ao consultar o status nao impede de entrar", async () => {
  server.use(
    http.get("*/api/v1/auth/status", () => HttpResponse.json({ detail: "x", code: "internal_error" }, { status: 500 })),
    loginOk(),
    meOk(),
  );
  renderLogin();
  await fillAndSubmit();
  expect(await screen.findByText("Painel logado")).toBeInTheDocument();
});

it("o botao de olho mostra e oculta a senha", async () => {
  server.use(status());
  renderLogin();
  await userEvent.type(passwordField(), "segredo123");
  expect(passwordField()).toHaveAttribute("type", "password");

  await userEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
  expect(passwordField()).toHaveAttribute("type", "text");
  expect(screen.getByRole("button", { name: "Ocultar senha" })).toHaveAttribute("aria-pressed", "true");

  await userEvent.click(screen.getByRole("button", { name: "Ocultar senha" }));
  expect(passwordField()).toHaveAttribute("type", "password");
});

it("a senha digitada nao aparece em nenhuma mensagem de erro", async () => {
  server.use(status(), loginFails("invalid_credentials", 401));
  renderLogin();
  await fillAndSubmit("ana@example.com", "minha-senha-secreta");
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(screen.getByRole("alert")).not.toHaveTextContent("minha-senha-secreta");
});

// ---------- Segundo passo (2FA) ----------

const twoFactorLogin = () =>
  http.post("*/api/v1/auth/login", () =>
    HttpResponse.json({ access_token: null, two_factor_required: true, challenge_token: "desafio" }),
  );
const verifyOk = (onBody?: (body: unknown) => void) =>
  http.post("*/api/v1/auth/2fa/verify", async ({ request }) => {
    onBody?.(await request.json());
    return HttpResponse.json({ access_token: "tok2", token_type: "bearer" });
  });
const verifyFails = (code: string, httpStatus = 401) =>
  http.post("*/api/v1/auth/2fa/verify", () => HttpResponse.json({ detail: "x", code }, { status: httpStatus }));

const codeField = () => screen.getByLabelText(/^Código de/);
const verifyButton = () => screen.getByRole("button", { name: /Verificar|Verificando/ });

async function reachSecondStep() {
  renderLogin();
  await screen.findByRole("heading", { name: "Entrar" });
  await fillAndSubmit();
  return await screen.findByRole("heading", { name: "Verificação em duas etapas" });
}

it("senha certa em conta com 2FA mostra o segundo passo e nao entra", async () => {
  server.use(status(), twoFactorLogin());
  await reachSecondStep();

  expect(codeField()).toHaveAccessibleName("Código de verificação");
  expect(codeField()).toHaveFocus();
  expect(screen.queryByLabelText("Senha")).not.toBeInTheDocument();
  expect(screen.queryByText("Painel logado")).not.toBeInTheDocument();
});

it("o codigo certo abre a sessao e leva ao painel", async () => {
  let sent: unknown;
  server.use(status(), twoFactorLogin(), verifyOk((body) => (sent = body)), meOk());
  await reachSecondStep();

  await userEvent.type(codeField(), " 123456 ");
  await userEvent.click(verifyButton());

  expect(await screen.findByText("Painel logado")).toBeInTheDocument();
  expect(sent).toEqual({ challenge_token: "desafio", code: "123456" });
});

it("codigo vazio mostra o erro, foca o campo e nao chama a API", async () => {
  let calls = 0;
  server.use(
    status(),
    twoFactorLogin(),
    http.post("*/api/v1/auth/2fa/verify", () => {
      calls += 1;
      return HttpResponse.json({ access_token: "x", token_type: "bearer" });
    }),
  );
  await reachSecondStep();

  await userEvent.click(verifyButton());

  expect(screen.getByText("Informe o código de 6 dígitos.")).toBeInTheDocument();
  expect(codeField()).toHaveFocus();
  expect(calls).toBe(0);
});

it("codigo errado mostra a mensagem e continua no segundo passo", async () => {
  server.use(status(), twoFactorLogin(), verifyFails("two_factor_invalid_code"));
  await reachSecondStep();

  await userEvent.type(codeField(), "000000");
  await userEvent.click(verifyButton());

  expect(await screen.findByRole("alert")).toHaveTextContent("Código inválido");
  expect(screen.getByRole("heading", { name: "Verificação em duas etapas" })).toBeInTheDocument();
  expect(verifyButton()).toBeEnabled();
});

it("conta bloqueada no segundo passo mostra o aviso de bloqueio", async () => {
  server.use(status(), twoFactorLogin(), verifyFails("account_locked", 423));
  await reachSecondStep();

  await userEvent.type(codeField(), "000000");
  await userEvent.click(verifyButton());

  expect(await screen.findByRole("alert")).toHaveTextContent("Conta bloqueada");
});

it("usar codigo de recuperacao troca o texto, limpa o campo e envia o codigo digitado", async () => {
  let sent: unknown;
  server.use(status(), twoFactorLogin(), verifyOk((body) => (sent = body)), meOk());
  await reachSecondStep();

  await userEvent.type(codeField(), "123");
  await userEvent.click(screen.getByRole("button", { name: "Usar um código de recuperação" }));

  expect(codeField()).toHaveAccessibleName("Código de recuperação");
  expect(codeField()).toHaveValue("");
  expect(codeField()).toHaveFocus();
  await userEvent.type(codeField(), "abcdef-123456");
  await userEvent.click(verifyButton());

  expect(await screen.findByText("Painel logado")).toBeInTheDocument();
  expect(sent).toEqual({ challenge_token: "desafio", code: "abcdef-123456" });
});

it("da para voltar ao codigo do app depois de escolher recuperacao", async () => {
  server.use(status(), twoFactorLogin());
  await reachSecondStep();

  await userEvent.click(screen.getByRole("button", { name: "Usar um código de recuperação" }));
  await userEvent.click(screen.getByRole("button", { name: "Usar o código do app" }));

  expect(codeField()).toHaveAccessibleName("Código de verificação");
});

it("Voltar retorna a senha com o e-mail preservado e a senha vazia", async () => {
  server.use(status(), twoFactorLogin());
  await reachSecondStep();

  await userEvent.click(screen.getByRole("button", { name: "Voltar" }));

  expect(screen.getByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  expect(emailField()).toHaveValue("ana@example.com");
  expect(passwordField()).toHaveValue("");
});

it("desafio vencido volta para a senha com a mensagem", async () => {
  server.use(status(), twoFactorLogin(), verifyFails("two_factor_challenge_invalid"));
  await reachSecondStep();

  await userEvent.type(codeField(), "123456");
  await userEvent.click(verifyButton());

  expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("O tempo para informar o código acabou");
});

it("o botao fica desabilitado enquanto verifica, sem enviar duas vezes", async () => {
  let calls = 0;
  server.use(
    status(),
    twoFactorLogin(),
    http.post("*/api/v1/auth/2fa/verify", async () => {
      calls += 1;
      await delay(150);
      return HttpResponse.json({ access_token: "tok2", token_type: "bearer" });
    }),
    meOk(),
  );
  await reachSecondStep();

  await userEvent.type(codeField(), "123456");
  await userEvent.click(verifyButton());
  expect(verifyButton()).toBeDisabled();
  await userEvent.click(verifyButton());

  await screen.findByText("Painel logado");
  expect(calls).toBe(1);
});
