import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { fakeApiTokensApi } from "@/test-utils/api-tokens-api";
import { fakeInstanceApi } from "@/test-utils/instance-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeTwoFactorApi, GOOD_CODE, GOOD_PASSWORD, SECRET } from "@/test-utils/two-factor-api";
import SecurityPage from "./security";

function renderPage(
  options: Parameters<typeof fakeTwoFactorApi>[0] = {},
  { strict = false, contact = null as string | null } = {},
) {
  const api = fakeTwoFactorApi(options);
  // A pagina tambem lista os tokens de API (aqui nao ha nenhum) e mostra o contato de seguranca
  server.use(...api.handlers, ...fakeApiTokensApi().handlers, ...fakeInstanceApi(contact).handlers);
  const page = (
    <FakeAuth>
      <MemoryRouter>
        <SecurityPage />
      </MemoryRouter>
    </FakeAuth>
  );
  render(strict ? <StrictMode>{page}</StrictMode> : page);
  return api;
}

const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());
const user = userEvent.setup();

// ---------- Estado ----------

it("conta sem 2FA mostra Desativada e o botao de ativar", async () => {
  renderPage();
  expect(await screen.findByText("Desativada")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ativar verificação em duas etapas" })).toBeInTheDocument();
  expect(screen.queryByText(/códigos de recuperação restantes/)).not.toBeInTheDocument();
});

it("conta com 2FA mostra Ativada e quantos codigos restam", async () => {
  renderPage({ enabled: true, remaining: 7 });
  expect(await screen.findByText("Ativada")).toBeInTheDocument();
  expect(screen.getByText("7 códigos de recuperação restantes")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Gerar novos códigos" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Desativar" })).toBeInTheDocument();
});

it("poucos codigos restantes mostram o aviso, no singular quando e um", async () => {
  renderPage({ enabled: true, remaining: 1 });
  expect(await screen.findByText("1 código de recuperação restante")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Restam poucos códigos");
});

it("sem nenhum codigo o aviso e mais forte", async () => {
  renderPage({ enabled: true, remaining: 0 });
  expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem mais códigos de recuperação");
});

it("falha ao carregar mostra o erro e tenta de novo", async () => {
  const api = renderPage();
  api.state.statusError = true;
  expect(await screen.findByRole("alert")).toBeInTheDocument();

  api.state.statusError = false;
  await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByText("Desativada")).toBeInTheDocument();
});

// ---------- Ativar ----------

async function openEnable() {
  await user.click(await screen.findByRole("button", { name: "Ativar verificação em duas etapas" }));
  await screen.findByRole("img", { name: "QR code para o app autenticador" });
}

it("abrir o dialogo gera o segredo uma vez e mostra o QR code e o segredo em texto", async () => {
  const api = renderPage();
  await openEnable();

  expect(api.calls("/setup")).toHaveLength(1);
  expect(inDialog().getByLabelText("Segredo")).toHaveTextContent(SECRET);
  expect(inDialog().getByRole("button", { name: "Ativar" })).toBeEnabled();
});

it("em StrictMode (desenvolvimento) o segredo tambem e gerado uma vez so", async () => {
  const api = renderPage({}, { strict: true });
  await openEnable();
  expect(api.calls("/setup")).toHaveLength(1);
});

it("codigo errado mostra o erro no campo e continua no mesmo passo", async () => {
  renderPage();
  await openEnable();

  await user.type(inDialog().getByLabelText("Código de verificação"), "000000");
  await user.click(inDialog().getByRole("button", { name: "Ativar" }));

  expect(await inDialog().findByText(/Código inválido/)).toBeInTheDocument();
  expect(inDialog().getByLabelText("Código de verificação")).toHaveFocus();
  expect(inDialog().queryByLabelText("Códigos de recuperação")).not.toBeInTheDocument();
});

it("codigo vazio mostra o erro sem chamar a API", async () => {
  const api = renderPage();
  await openEnable();

  await user.click(inDialog().getByRole("button", { name: "Ativar" }));

  expect(inDialog().getByText("Informe o código de 6 dígitos.")).toBeInTheDocument();
  expect(api.calls("/enable")).toHaveLength(0);
});

it("falha que nao e do codigo aparece no aviso do topo", async () => {
  const api = renderPage();
  await openEnable();
  api.state.nextEnableError = { status: 500, code: "internal_error" };

  await user.type(inDialog().getByLabelText("Código de verificação"), GOOD_CODE);
  await user.click(inDialog().getByRole("button", { name: "Ativar" }));

  expect(await inDialog().findByRole("alert")).toBeInTheDocument();
  expect(inDialog().queryByText(/Código inválido/)).not.toBeInTheDocument();
});

it("codigo certo mostra os 10 codigos de recuperacao e so conclui depois de confirmar que guardou", async () => {
  const api = renderPage();
  await openEnable();

  await user.type(inDialog().getByLabelText("Código de verificação"), ` ${GOOD_CODE} `);
  await user.click(inDialog().getByRole("button", { name: "Ativar" }));

  const list = await inDialog().findByRole("list", { name: "Códigos de recuperação" });
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(api.codes);
  expect(api.calls("/enable")[0].body).toEqual({ code: GOOD_CODE });

  const done = inDialog().getByRole("button", { name: "Concluir" });
  expect(done).toBeDisabled();
  await user.click(inDialog().getByLabelText("Guardei meus códigos em um lugar seguro"));
  expect(done).toBeEnabled();
  await user.click(done);

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByText("Ativada")).toBeInTheDocument();
  expect(screen.getByText("10 códigos de recuperação restantes")).toBeInTheDocument();
});

it("os codigos nao somem com Esc antes de confirmar que guardou", async () => {
  renderPage();
  await openEnable();
  await user.type(inDialog().getByLabelText("Código de verificação"), GOOD_CODE);
  await user.click(inDialog().getByRole("button", { name: "Ativar" }));
  await inDialog().findByRole("list", { name: "Códigos de recuperação" });

  await user.keyboard("{Escape}");

  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(inDialog().getByRole("list", { name: "Códigos de recuperação" })).toBeInTheDocument();
});

it("copiar os codigos coloca todos na area de transferencia", async () => {
  const api = renderPage();
  await openEnable();
  await user.type(inDialog().getByLabelText("Código de verificação"), GOOD_CODE);
  await user.click(inDialog().getByRole("button", { name: "Ativar" }));
  await inDialog().findByRole("list", { name: "Códigos de recuperação" });

  await user.click(inDialog().getByRole("button", { name: "Copiar códigos" }));

  expect(await inDialog().findByText("Códigos copiados.")).toBeInTheDocument();
  expect(await navigator.clipboard.readText()).toBe(api.codes.join("\n"));
});

it("se nao der para copiar, avisa para copiar a mao", async () => {
  renderPage();
  await openEnable();
  await user.type(inDialog().getByLabelText("Código de verificação"), GOOD_CODE);
  await user.click(inDialog().getByRole("button", { name: "Ativar" }));
  await inDialog().findByRole("list", { name: "Códigos de recuperação" });
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("negado"));

  await user.click(inDialog().getByRole("button", { name: "Copiar códigos" }));

  expect(await inDialog().findByText(/Não foi possível copiar/)).toBeInTheDocument();
});

it("cancelar antes de ativar fecha sem ativar", async () => {
  const api = renderPage();
  await openEnable();

  await user.click(inDialog().getByRole("button", { name: "Cancelar" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.calls("/enable")).toHaveLength(0);
  expect(screen.getByText("Desativada")).toBeInTheDocument();
});

it("falha ao gerar o segredo mostra o erro e permite tentar de novo", async () => {
  const api = renderPage();
  api.state.setupError = true;
  await user.click(await screen.findByRole("button", { name: "Ativar verificação em duas etapas" }));

  expect(await inDialog().findByRole("alert")).toBeInTheDocument();
  expect(inDialog().getByRole("button", { name: "Ativar" })).toBeDisabled();

  api.state.setupError = false;
  await user.click(inDialog().getByRole("button", { name: "Tentar de novo" }));
  expect(await inDialog().findByRole("img", { name: "QR code para o app autenticador" })).toBeInTheDocument();
});

// ---------- Desativar ----------

async function openConfirm(button: string) {
  await user.click(await screen.findByRole("button", { name: button }));
  return await screen.findByRole("dialog");
}

it("desativar pede senha e codigo, e depois a pagina mostra Desativada", async () => {
  const api = renderPage({ enabled: true });
  await openConfirm("Desativar");

  await user.type(inDialog().getByLabelText("Senha"), GOOD_PASSWORD);
  await user.type(inDialog().getByLabelText("Código de verificação"), GOOD_CODE);
  await user.click(inDialog().getByRole("button", { name: "Desativar" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByText("Desativada")).toBeInTheDocument();
  expect(api.calls("/disable")[0].body).toEqual({ password: GOOD_PASSWORD, code: GOOD_CODE });
});

it("senha errada ao desativar aparece no campo da senha", async () => {
  renderPage({ enabled: true });
  await openConfirm("Desativar");

  await user.type(inDialog().getByLabelText("Senha"), "errada");
  await user.type(inDialog().getByLabelText("Código de verificação"), GOOD_CODE);
  await user.click(inDialog().getByRole("button", { name: "Desativar" }));

  expect(await inDialog().findByText("Senha incorreta.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Senha")).toHaveFocus();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("codigo errado ao desativar aparece no campo do codigo", async () => {
  renderPage({ enabled: true });
  await openConfirm("Desativar");

  await user.type(inDialog().getByLabelText("Senha"), GOOD_PASSWORD);
  await user.type(inDialog().getByLabelText("Código de verificação"), "000000");
  await user.click(inDialog().getByRole("button", { name: "Desativar" }));

  expect(await inDialog().findByText(/Código inválido/)).toBeInTheDocument();
  expect(inDialog().getByLabelText("Código de verificação")).toHaveFocus();
});

it("campos vazios ao desativar mostram os erros sem chamar a API", async () => {
  const api = renderPage({ enabled: true });
  await openConfirm("Desativar");

  await user.click(inDialog().getByRole("button", { name: "Desativar" }));

  expect(inDialog().getByText("Informe a senha.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe um código do app ou de recuperação.")).toBeInTheDocument();
  expect(api.calls("/disable")).toHaveLength(0);
});

it("cancelar a desativacao mantem tudo ligado", async () => {
  const api = renderPage({ enabled: true });
  await openConfirm("Desativar");
  await user.click(inDialog().getByRole("button", { name: "Cancelar" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.calls("/disable")).toHaveLength(0);
  expect(screen.getByText("Ativada")).toBeInTheDocument();
});

// ---------- Novos codigos ----------

it("gerar novos codigos mostra os novos e atualiza a contagem", async () => {
  const api = renderPage({ enabled: true, remaining: 2 });
  await openConfirm("Gerar novos códigos");

  await user.type(inDialog().getByLabelText("Senha"), GOOD_PASSWORD);
  await user.type(inDialog().getByLabelText("Código de verificação"), GOOD_CODE);
  await user.click(inDialog().getByRole("button", { name: "Gerar novos códigos" }));

  const list = await inDialog().findByRole("list", { name: "Códigos de recuperação" });
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(api.newCodes);
  expect(inDialog().getByRole("button", { name: "Concluir" })).toBeDisabled();

  await user.click(inDialog().getByLabelText("Guardei meus códigos em um lugar seguro"));
  await user.click(inDialog().getByRole("button", { name: "Concluir" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByText("10 códigos de recuperação restantes")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("senha errada ao gerar codigos nao troca nada", async () => {
  const api = renderPage({ enabled: true, remaining: 4 });
  await openConfirm("Gerar novos códigos");

  await user.type(inDialog().getByLabelText("Senha"), "errada");
  await user.type(inDialog().getByLabelText("Código de verificação"), GOOD_CODE);
  await user.click(inDialog().getByRole("button", { name: "Gerar novos códigos" }));

  expect(await inDialog().findByText("Senha incorreta.")).toBeInTheDocument();
  expect(api.state.remaining).toBe(4);
  expect(inDialog().queryByRole("list", { name: "Códigos de recuperação" })).not.toBeInTheDocument();
});

// ---------- Contato de seguranca ----------

it("sem contato definido a pagina nao fala de contato", async () => {
  renderPage();
  await screen.findByText("Desativada");
  expect(screen.queryByText(/relatar um problema de segurança/)).not.toBeInTheDocument();
});

it("com um e-mail, o contato aparece como link para escrever", async () => {
  renderPage({}, { contact: "seguranca@example.com" });
  const link = await screen.findByRole("link", { name: "seguranca@example.com" });
  expect(link).toHaveAttribute("href", "mailto:seguranca@example.com");
  expect(screen.getByText(/Para relatar um problema de segurança nesta instalação/)).toBeInTheDocument();
});

it("com um endereco https, o contato abre o proprio endereco", async () => {
  renderPage({}, { contact: "https://exemplo.com/contato" });
  const link = await screen.findByRole("link", { name: "https://exemplo.com/contato" });
  expect(link).toHaveAttribute("href", "https://exemplo.com/contato");
  expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
});
