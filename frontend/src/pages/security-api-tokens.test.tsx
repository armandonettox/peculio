import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApiTokensApi, makeApiToken } from "@/test-utils/api-tokens-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeInstanceApi } from "@/test-utils/instance-api";
import { fakeSessionsApi } from "@/test-utils/sessions-api";
import { fakeTwoFactorApi } from "@/test-utils/two-factor-api";
import SecurityPage from "./security";

// "Hoje" fixo: a validade e o aviso de "perto de vencer" dependem do dia
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T15:00:00Z"));
});
afterEach(() => vi.useRealTimers());

function renderPage(tokens: ReturnType<typeof makeApiToken>[] = []) {
  const api = fakeApiTokensApi(tokens);
  server.use(...api.handlers, ...fakeTwoFactorApi().handlers, ...fakeInstanceApi().handlers, ...fakeSessionsApi().handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <SecurityPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const user = userEvent.setup();
const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());
const list = () => screen.getByRole("list", { name: "Tokens de API" });
const item = (name: string) => within(list()).getByRole("heading", { level: 3, name }).closest("li") as HTMLElement;
const openCreate = async () => {
  await user.click(await screen.findByRole("button", { name: "Criar token" }));
  return dialog();
};

// ---------- Lista ----------

it("sem tokens diz que ainda nao ha nenhum e oferece criar", async () => {
  renderPage();
  expect(await screen.findByText("Você ainda não tem nenhum token.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Criar token" })).toBeEnabled();
  expect(screen.queryByRole("list", { name: "Tokens de API" })).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("cada token mostra nome, permissao, comeco do valor, validade e ultimo uso", async () => {
  renderPage([
    makeApiToken({ name: "Planilha", prefix: "fin_ab12cd34", scope: "read", expires_at: "2026-06-13T15:00:00Z", last_used_at: "2026-03-12T18:30:00Z" }),
    makeApiToken({ name: "Automacao", scope: "write", expires_at: null }),
  ]);
  await screen.findByRole("list", { name: "Tokens de API" });
  const sheet = item("Planilha");
  expect(within(sheet).getByText("Só leitura")).toBeInTheDocument();
  expect(within(sheet).getByText("fin_ab12cd34…")).toBeInTheDocument();
  expect(within(sheet).getByText("Vence em 13/06/2026")).toBeInTheDocument();
  expect(within(sheet).getByText("Último uso: 12/03/2026")).toBeInTheDocument();

  const auto = item("Automacao");
  expect(within(auto).getByText("Leitura e escrita")).toBeInTheDocument();
  expect(within(auto).getByText("Nunca expira")).toBeInTheDocument();
  expect(within(auto).getByText("Nunca usado")).toBeInTheDocument();
});

it("a lista nunca mostra mais que o comeco do token", async () => {
  const api = renderPage();
  await user.click(await screen.findByRole("button", { name: "Criar token" }));
  await user.type(inDialog().getByLabelText("Nome"), "Script");
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  const value = (await inDialog().findByLabelText("Token")).textContent ?? "";
  await user.click(inDialog().getByLabelText("Copiei o token e guardei em um lugar seguro"));
  await user.click(inDialog().getByRole("button", { name: "Concluir" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const sheet = item("Script");
  expect(within(sheet).getByText(`${value.slice(0, 12)}…`)).toBeInTheDocument();
  expect(screen.queryByText(value)).not.toBeInTheDocument();
  expect(Object.values(api.state.values)).toEqual([value]);
});

it("token vencido ou perto de vencer aparece com texto e no aviso do topo, no singular", async () => {
  renderPage([
    makeApiToken({ name: "Velho", expired: true, expires_at: "2026-03-10T12:00:00Z" }),
    makeApiToken({ name: "Bom", expires_at: "2026-09-01T15:00:00Z" }),
  ]);
  await screen.findByRole("list", { name: "Tokens de API" });
  expect(within(item("Velho")).getByText("Venceu em 10/03/2026")).toBeInTheDocument();
  expect(within(item("Velho")).getByText("Venceu em 10/03/2026")).toHaveClass("text-destructive");
  expect(within(item("Bom")).getByText("Vence em 01/09/2026")).not.toHaveClass("text-destructive");
  expect(screen.getByRole("alert")).toHaveTextContent("1 token venceu ou vence em breve. Crie um novo e revogue o antigo.");
});

it("perto de vencer: diz em quantos dias, e o aviso vai para o plural com varios", async () => {
  renderPage([
    makeApiToken({ name: "Amanha", expires_at: "2026-03-16T15:00:00Z" }),
    makeApiToken({ name: "Tres", expires_at: "2026-03-18T15:00:00Z" }),
  ]);
  await screen.findByRole("list", { name: "Tokens de API" });
  expect(within(item("Amanha")).getByText("Vence em 16/03/2026 (amanhã)")).toBeInTheDocument();
  expect(within(item("Tres")).getByText("Vence em 18/03/2026 (em 3 dias)")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("2 tokens venceram ou vencem em breve. Crie novos e revogue os antigos.");
});

it("sem token em risco nao ha aviso", async () => {
  renderPage([makeApiToken({ name: "Ok", expires_at: "2026-12-01T15:00:00Z" }), makeApiToken({ name: "Nunca" })]);
  await screen.findByRole("list", { name: "Tokens de API" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("falha ao carregar mostra o erro e permite tentar de novo", async () => {
  const api = renderPage([makeApiToken({ name: "Volta" })]);
  api.state.listError = true;
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Algo deu errado do nosso lado");
  api.state.listError = false;
  await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("heading", { level: 3, name: "Volta" })).toBeInTheDocument();
});

it("com 10 tokens o botao de criar fica desabilitado e explica", async () => {
  renderPage(Array.from({ length: 10 }, (_, n) => makeApiToken({ name: `T${n}` })));
  await screen.findByRole("list", { name: "Tokens de API" });
  expect(screen.getByRole("button", { name: "Criar token" })).toBeDisabled();
  expect(screen.getByText("Você chegou ao limite de 10 tokens. Revogue algum para criar outro.")).toBeInTheDocument();
});

it("com 9 tokens ainda cria", async () => {
  renderPage(Array.from({ length: 9 }, (_, n) => makeApiToken({ name: `T${n}` })));
  await screen.findByRole("list", { name: "Tokens de API" });
  expect(screen.getByRole("button", { name: "Criar token" })).toBeEnabled();
  expect(screen.queryByText(/limite de 10 tokens/)).not.toBeInTheDocument();
});

// ---------- Criar ----------

it("o formulario abre com so leitura, 90 dias e nome vazio", async () => {
  renderPage();
  await openCreate();
  expect(inDialog().getByLabelText("Nome")).toHaveValue("");
  expect(inDialog().getByRole("radio", { name: /Só leitura/ })).toBeChecked();
  expect(inDialog().getByRole("radio", { name: /Leitura e escrita/ })).not.toBeChecked();
  const validity = inDialog().getByLabelText("Validade") as HTMLSelectElement;
  expect(validity.value).toBe("90");
  expect(within(validity).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "30 dias",
    "90 dias (sugerido)",
    "1 ano",
    "Nunca expira",
  ]);
});

it("sem nome mostra o aviso no campo e nao chama a API", async () => {
  const api = renderPage();
  await openCreate();
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  expect(inDialog().getByText("Informe um nome para reconhecer este token.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
  await user.type(inDialog().getByLabelText("Nome"), "x");
  expect(inDialog().queryByText("Informe um nome para reconhecer este token.")).not.toBeInTheDocument();
});

it("nome so com espacos tambem conta como vazio", async () => {
  const api = renderPage();
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "   ");
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  expect(inDialog().getByText("Informe um nome para reconhecer este token.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("envia nome, permissao e validade escolhidos (padrao: so leitura e 90 dias)", async () => {
  const api = renderPage();
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "  Planilha  ");
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  await inDialog().findByLabelText("Token");
  expect(api.mutations()[0].body).toEqual({ name: "Planilha", scope: "read", expires_in_days: 90 });
});

it("leitura e escrita com 'Nunca expira' manda a validade vazia", async () => {
  const api = renderPage();
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "Automacao");
  await user.click(inDialog().getByRole("radio", { name: /Leitura e escrita/ }));
  await user.selectOptions(inDialog().getByLabelText("Validade"), "Nunca expira");
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  await inDialog().findByLabelText("Token");
  expect(api.mutations()[0].body).toEqual({ name: "Automacao", scope: "write", expires_in_days: null });
});

it.each([
  ["30 dias", 30],
  ["1 ano", 365],
])("a validade %s manda %i dias", async (label, days) => {
  const api = renderPage();
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "T");
  await user.selectOptions(inDialog().getByLabelText("Validade"), label);
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  await inDialog().findByLabelText("Token");
  expect((api.mutations()[0].body as { expires_in_days: number }).expires_in_days).toBe(days);
});

it("mostra que esta criando e trava o botao", async () => {
  const api = renderPage();
  api.state.holdCreate = true;
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "Lento");
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  expect(await inDialog().findByRole("button", { name: "Criando..." })).toBeDisabled();
  api.state.release?.();
  await inDialog().findByLabelText("Token");
});

it("depois de criar mostra o valor uma vez, como usar e so deixa concluir depois de marcar que guardou", async () => {
  renderPage();
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "Script");
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  const token = await inDialog().findByLabelText("Token");
  expect(token.textContent).toMatch(/^fin_\w{43}$/);
  expect(inDialog().getByRole("heading", { name: "Token criado" })).toBeInTheDocument();
  expect(inDialog().getByText(/Authorization: Bearer/)).toBeInTheDocument();
  expect(inDialog().getByText(/Trate como uma senha/)).toBeInTheDocument();
  expect(inDialog().queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();

  const done = inDialog().getByRole("button", { name: "Concluir" });
  expect(done).toBeDisabled();
  await user.click(inDialog().getByLabelText("Copiei o token e guardei em um lugar seguro"));
  expect(done).toBeEnabled();
  await user.click(done);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("enquanto o valor esta na tela a janela nao fecha por Esc nem por clique fora", async () => {
  renderPage();
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "Script");
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  await inDialog().findByLabelText("Token");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Token")).toBeInTheDocument();
});

it("copia o token para a area de transferencia", async () => {
  const api = renderPage();
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "Script");
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  await inDialog().findByLabelText("Token");
  await user.click(inDialog().getByRole("button", { name: "Copiar token" }));
  expect(await inDialog().findByText("Token copiado.")).toBeInTheDocument();
  expect(await navigator.clipboard.readText()).toBe(Object.values(api.state.values)[0]);
});

it("se nao der para copiar, avisa para copiar a mao", async () => {
  renderPage();
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "Script");
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  await inDialog().findByLabelText("Token");
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("negado"));
  await user.click(inDialog().getByRole("button", { name: "Copiar token" }));
  expect(await inDialog().findByText(/Não foi possível copiar/)).toBeInTheDocument();
});

it("nome repetido aparece no campo e a janela continua aberta", async () => {
  renderPage([makeApiToken({ name: "Script" })]);
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "script");
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  expect(await inDialog().findByText("Já existe um token com esse nome.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
  expect(inDialog().queryByLabelText("Token")).not.toBeInTheDocument();
});

it("outra falha vai no aviso do topo da janela e nada se perde", async () => {
  const api = renderPage();
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "Script");
  await user.click(inDialog().getByRole("radio", { name: /Leitura e escrita/ }));
  api.state.nextCreateError = { status: 409, code: "api_token_limit_reached" };
  await user.click(inDialog().getByRole("button", { name: "Criar token" }));
  expect(await inDialog().findByRole("alert")).toHaveTextContent("Você chegou ao limite de 10 tokens");
  expect(inDialog().getByLabelText("Nome")).toHaveValue("Script");
  expect(inDialog().getByRole("radio", { name: /Leitura e escrita/ })).toBeChecked();
});

it("cancelar fecha sem criar", async () => {
  const api = renderPage();
  await openCreate();
  await user.type(inDialog().getByLabelText("Nome"), "Script");
  await user.click(inDialog().getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(0);
});

it("Esc fecha o formulario antes de criar", async () => {
  renderPage();
  await openCreate();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

// ---------- Revogar ----------

it("revogar pede confirmacao com o nome e o que acontece", async () => {
  const api = renderPage([makeApiToken({ name: "Planilha" })]);
  await screen.findByRole("list", { name: "Tokens de API" });
  await user.click(screen.getByRole("button", { name: "Revogar o token Planilha" }));
  expect(inDialog().getByRole("heading", { name: "Revogar token" })).toBeInTheDocument();
  expect(inDialog().getByText("Planilha")).toBeInTheDocument();
  expect(inDialog().getByText(/corta, agora, o acesso/)).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("confirmar manda o pedido e o token some da lista", async () => {
  const api = renderPage([makeApiToken({ name: "Planilha" }), makeApiToken({ name: "Outro" })]);
  await screen.findByRole("list", { name: "Tokens de API" });
  await user.click(screen.getByRole("button", { name: "Revogar o token Planilha" }));
  await user.click(inDialog().getByRole("button", { name: "Revogar" }));
  await waitFor(() => expect(screen.queryByRole("heading", { level: 3, name: "Planilha" })).not.toBeInTheDocument());
  expect(screen.getByRole("heading", { level: 3, name: "Outro" })).toBeInTheDocument();
  expect(api.mutations().map((request) => request.method)).toEqual(["DELETE"]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("cancelar a revogacao nao chama a API e o token continua", async () => {
  const api = renderPage([makeApiToken({ name: "Planilha" })]);
  await screen.findByRole("list", { name: "Tokens de API" });
  await user.click(screen.getByRole("button", { name: "Revogar o token Planilha" }));
  await user.click(inDialog().getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(0);
  expect(screen.getByRole("heading", { level: 3, name: "Planilha" })).toBeInTheDocument();
});

it("falha ao revogar mostra o erro, continua aberto e o token fica", async () => {
  const api = renderPage([makeApiToken({ name: "Planilha" })]);
  await screen.findByRole("list", { name: "Tokens de API" });
  await user.click(screen.getByRole("button", { name: "Revogar o token Planilha" }));
  api.state.nextRevokeError = { status: 404, code: "api_token_not_found" };
  await user.click(inDialog().getByRole("button", { name: "Revogar" }));
  expect(await inDialog().findByRole("alert")).toHaveTextContent("Token não encontrado.");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.click(inDialog().getByRole("button", { name: "Cancelar" }));
  expect(screen.getByRole("heading", { level: 3, name: "Planilha" })).toBeInTheDocument();
});

it("revogar libera a vaga: com 10 tokens o botao de criar volta", async () => {
  renderPage(Array.from({ length: 10 }, (_, n) => makeApiToken({ name: `T${n}` })));
  await screen.findByRole("list", { name: "Tokens de API" });
  expect(screen.getByRole("button", { name: "Criar token" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Revogar o token T3" }));
  await user.click(inDialog().getByRole("button", { name: "Revogar" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Criar token" })).toBeEnabled());
});
