import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { User } from "@/auth/auth-context";
import { tokenStore } from "@/auth/token-store";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_STORAGE_KEY } from "@/hooks/use-theme";
import { fakeAccountsApi } from "@/test-utils/accounts-api";
import { fakeInstanceApi } from "@/test-utils/instance-api";
import { server } from "@/test-utils/msw";
import { FakeAuth, testUser } from "@/test-utils/providers";
import { fakeAccountApi, fakeInvitesApi, makeInvite } from "@/test-utils/settings-api";
import SettingsPage from "./settings";

const user = userEvent.setup();

const admin: User = { ...testUser, is_admin: true, name: "Ana Teste", default_currency: "BRL" };
const member: User = { ...testUser, is_admin: false, name: "Bruno Convidado", email: "bruno@example.com", default_currency: "BRL" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  tokenStore.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderPage({
  as = admin,
  invites = [] as ReturnType<typeof makeInvite>[],
  updateUser = vi.fn(),
  contact = null as string | null,
  readError = false,
} = {}) {
  const account = fakeAccountApi(as);
  const invitesApi = fakeInvitesApi(invites);
  const instance = fakeInstanceApi(contact);
  instance.state.readError = readError;
  server.use(...account.handlers, ...invitesApi.handlers, ...instance.handlers, ...fakeAccountsApi([]).handlers);
  render(
    <FakeAuth user={as} updateUser={updateUser}>
      <MemoryRouter>
        <ThemeToggle />
        <SettingsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return { account, invitesApi, instance, updateUser };
}

const field = (label: string) => screen.getByLabelText(label, { exact: true }) as HTMLInputElement | HTMLSelectElement;

// A pagina agora e em abas (Perfil, Aparencia, Seguranca e, so para admin, Administracao); so uma fica montada por vez.
async function openTab(name: string) {
  await user.click(await screen.findByRole("button", { name }));
}

// ---------- A pagina ----------

it("mostra as abas de qualquer usuario, Perfil ja aberta", async () => {
  renderPage({ as: member });
  expect(await screen.findByRole("heading", { level: 1, name: "Configurações" })).toBeInTheDocument();
  for (const title of ["Perfil", "Aparência", "Segurança"]) expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
  // Perfil e Senha vem juntas na aba que abre por padrao
  expect(screen.getByRole("heading", { name: "Perfil" })).toBeInTheDocument();
  expect(screen.getByText("Senha")).toBeInTheDocument();
});

it("so o administrador ve a aba Administracao, e quem nao e nem pede a lista de convites", async () => {
  const { invitesApi } = renderPage({ as: member });
  await screen.findByRole("heading", { name: "Perfil" });
  expect(screen.queryByRole("button", { name: "Administração" })).not.toBeInTheDocument();
  expect(invitesApi.state.requests).toEqual([]);
});

it("o administrador ve a aba Administracao, com convites e contato de seguranca", async () => {
  renderPage({ as: admin });
  await openTab("Administração");
  expect(await screen.findByText("Usuários e convites")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Contato de segurança" })).toBeInTheDocument();
});

it("a aba Seguranca mostra a verificacao em duas etapas", async () => {
  renderPage();
  await openTab("Segurança");
  expect(await screen.findByRole("heading", { level: 2, name: "Verificação em duas etapas" })).toBeInTheDocument();
});

// ---------- Perfil ----------

it("o perfil abre com os dados da conta, o e-mail so de leitura e Salvar desligado", async () => {
  renderPage();
  expect(await screen.findByDisplayValue("Ana Teste")).toBeInTheDocument();
  expect(field("E-mail")).toHaveValue(admin.email);
  expect(field("E-mail")).toHaveAttribute("readonly");
  expect(screen.getByRole("button", { name: "Salvar perfil" })).toBeDisabled();
});

it("trocar o nome manda so o nome, avisa e atualiza o usuario do app", async () => {
  const { account, updateUser } = renderPage();
  const name = await screen.findByLabelText("Nome");
  await user.clear(name);
  await user.type(name, "  Ana Maria  ");
  await user.click(screen.getByRole("button", { name: "Salvar perfil" }));
  await waitFor(() => expect(account.state.profileRequests).toHaveLength(1));
  expect(account.state.profileRequests[0]).toEqual({ name: "Ana Maria" });
  expect(await screen.findByText("Perfil salvo.")).toBeVisible();
  expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({ name: "Ana Maria" }));
  expect(screen.getByRole("button", { name: "Salvar perfil" })).toBeDisabled();
});

it("trocar so a moeda manda so a moeda", async () => {
  const { account } = renderPage();
  await screen.findByDisplayValue("Ana Teste");
  await screen.findByRole("option", { name: /USD/ });
  await user.selectOptions(field("Moeda padrão"), "USD");
  await user.click(screen.getByRole("button", { name: "Salvar perfil" }));
  await waitFor(() => expect(account.state.profileRequests).toHaveLength(1));
  expect(account.state.profileRequests[0]).toEqual({ default_currency: "USD" });
});

it("nome vazio mostra o erro, foca o campo e nao chama o servidor", async () => {
  const { account } = renderPage();
  const name = await screen.findByLabelText("Nome");
  await user.clear(name);
  await user.click(screen.getByRole("button", { name: "Salvar perfil" }));
  expect(await screen.findByText("Informe o nome.")).toBeVisible();
  expect(name).toHaveFocus();
  expect(account.state.profileRequests).toHaveLength(0);
});

it("Enter no nome sem nenhuma mudanca nao chama o servidor", async () => {
  const { account } = renderPage();
  const name = await screen.findByLabelText("Nome");
  await user.click(name);
  await user.keyboard("{Enter}");
  expect(account.state.profileRequests).toHaveLength(0);
  expect(screen.queryByText("Perfil salvo.")).not.toBeInTheDocument();
});

it("o erro do servidor aparece e o perfil continua editavel", async () => {
  const { account } = renderPage();
  const name = await screen.findByLabelText("Nome");
  await user.type(name, " Silva");
  account.state.nextError = { status: 500, code: "internal_error" };
  await user.click(screen.getByRole("button", { name: "Salvar perfil" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("Perfil salvo.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Salvar perfil" })).toBeEnabled();
});

it("o aviso de perfil salvo some quando a pessoa volta a editar", async () => {
  renderPage();
  const name = await screen.findByLabelText("Nome");
  await user.type(name, "x");
  await user.click(screen.getByRole("button", { name: "Salvar perfil" }));
  await screen.findByText("Perfil salvo.");
  await user.type(name, "y");
  expect(screen.queryByText("Perfil salvo.")).not.toBeInTheDocument();
});

// ---------- Senha ----------

async function fillPassword({ current = "SenhaAtual123", next = "NovaSenha456", confirm = "NovaSenha456" } = {}) {
  await user.type(field("Senha atual"), current);
  await user.type(field("Nova senha"), next);
  await user.type(field("Repita a nova senha"), confirm);
}

it("trocar a senha manda as duas, limpa o formulario, avisa e guarda o token novo", async () => {
  const { account } = renderPage();
  await screen.findByLabelText("Senha atual");
  await fillPassword();
  await user.click(screen.getByRole("button", { name: "Trocar senha" }));
  await waitFor(() => expect(account.state.passwordRequests).toHaveLength(1));
  expect(account.state.passwordRequests[0]).toEqual({ current_password: "SenhaAtual123", new_password: "NovaSenha456" });
  expect(await screen.findByText("Senha alterada. As outras sessões foram encerradas.")).toBeVisible();
  expect(field("Senha atual")).toHaveValue("");
  expect(field("Nova senha")).toHaveValue("");
  expect(field("Repita a nova senha")).toHaveValue("");
  expect(tokenStore.get()).toBe(account.state.newToken);
});

it("formulario vazio mostra os erros e nao chama o servidor", async () => {
  const { account } = renderPage();
  await screen.findByLabelText("Senha atual");
  await user.click(screen.getByRole("button", { name: "Trocar senha" }));
  expect(await screen.findByText("Informe a senha atual.")).toBeVisible();
  expect(screen.getByText("A senha precisa ter pelo menos 8 caracteres.")).toBeVisible();
  expect(field("Senha atual")).toHaveFocus();
  expect(account.state.passwordRequests).toHaveLength(0);
});

it("a confirmacao diferente e recusada antes de ir ao servidor", async () => {
  const { account } = renderPage();
  await screen.findByLabelText("Senha atual");
  await fillPassword({ confirm: "Diferente789" });
  await user.click(screen.getByRole("button", { name: "Trocar senha" }));
  expect(await screen.findByText("As senhas não conferem.")).toBeVisible();
  expect(field("Repita a nova senha")).toHaveFocus();
  expect(account.state.passwordRequests).toHaveLength(0);
});

it("a nova senha igual a atual e recusada", async () => {
  const { account } = renderPage();
  await screen.findByLabelText("Senha atual");
  await fillPassword({ current: "MesmaSenha1", next: "MesmaSenha1", confirm: "MesmaSenha1" });
  await user.click(screen.getByRole("button", { name: "Trocar senha" }));
  expect(await screen.findByText("A nova senha precisa ser diferente da atual.")).toBeVisible();
  expect(account.state.passwordRequests).toHaveLength(0);
});

it("senha atual errada vira erro do campo, sem limpar o que foi digitado e sem trocar o token", async () => {
  const { account } = renderPage();
  await screen.findByLabelText("Senha atual");
  await fillPassword({ current: "Errada12345" });
  await user.click(screen.getByRole("button", { name: "Trocar senha" }));
  expect(await screen.findByText("Senha atual incorreta.")).toBeVisible();
  expect(field("Senha atual")).toHaveFocus();
  expect(field("Nova senha")).toHaveValue("NovaSenha456");
  expect(tokenStore.get()).toBeNull();
  expect(account.state.passwordRequests).toHaveLength(1);
});

it("outro erro do servidor (limite de tentativas) vira aviso do formulario", async () => {
  const { account } = renderPage();
  await screen.findByLabelText("Senha atual");
  await fillPassword();
  account.state.nextError = { status: 429, code: "rate_limited" };
  await user.click(screen.getByRole("button", { name: "Trocar senha" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("Senha atual incorreta.")).not.toBeInTheDocument();
});

it("os campos de senha tem o preenchimento automatico certo (gerenciador de senhas)", async () => {
  renderPage();
  await screen.findByLabelText("Senha atual");
  expect(field("Senha atual")).toHaveAttribute("autocomplete", "current-password");
  expect(field("Nova senha")).toHaveAttribute("autocomplete", "new-password");
  expect(field("Repita a nova senha")).toHaveAttribute("autocomplete", "new-password");
});

// ---------- Aparencia ----------

it("a escolha do tema reflete o que esta guardado e muda a pagina", async () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, "light");
  renderPage();
  await openTab("Aparência");
  const group = await screen.findByRole("radiogroup", { name: "Tema" });
  expect(within(group).getByRole("radio", { name: /Claro/ })).toBeChecked();
  await user.click(within(group).getByRole("radio", { name: /Escuro/ }));
  expect(within(group).getByRole("radio", { name: /Escuro/ })).toBeChecked();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
});

it("o botao do topo acompanha a escolha feita em Configuracoes", async () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, "light");
  renderPage();
  await openTab("Aparência");
  expect(await screen.findByRole("button", { name: "Mudar para o tema escuro" })).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: /Escuro/ }));
  expect(await screen.findByRole("button", { name: "Mudar para o tema claro" })).toBeInTheDocument();
});

it("e o botao do topo muda a escolha em Configuracoes", async () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, "light");
  renderPage();
  await openTab("Aparência");
  await user.click(await screen.findByRole("button", { name: "Mudar para o tema escuro" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: /Escuro/ })).toBeChecked());
});

it("do sistema e a escolha quando nada foi guardado", async () => {
  renderPage();
  await openTab("Aparência");
  expect(await screen.findByRole("radio", { name: /Do sistema/ })).toBeChecked();
});

// ---------- Convites (administrador) ----------

it("lista os convites com a situacao de cada um e so deixa revogar os pendentes", async () => {
  renderPage({
    invites: [
      makeInvite({ email: "pendente@example.com", expires_at: "2026-03-13T12:00:00Z" }),
      makeInvite({ email: "usado@example.com", used_at: "2026-03-02T10:00:00Z" }),
      makeInvite({ email: "vencido@example.com", expires_at: "2026-03-05T10:00:00Z" }),
    ],
  });
  await openTab("Administração");
  const list = await screen.findByText("pendente@example.com");
  const rowOf = (email: string) => screen.getByText(email).closest("li") as HTMLElement;
  expect(list).toBeInTheDocument();
  expect(rowOf("pendente@example.com")).toHaveTextContent("Vence em 3 dias");
  expect(rowOf("usado@example.com")).toHaveTextContent("Usado");
  expect(rowOf("vencido@example.com")).toHaveTextContent("Vencido");
  expect(within(rowOf("pendente@example.com")).getByRole("button", { name: /Revogar/ })).toBeInTheDocument();
  expect(within(rowOf("usado@example.com")).queryByRole("button")).not.toBeInTheDocument();
  expect(within(rowOf("vencido@example.com")).queryByRole("button")).not.toBeInTheDocument();
});

it("sem convites, diz isso", async () => {
  renderPage();
  await openTab("Administração");
  expect(await screen.findByText("Nenhum convite criado ainda.")).toBeInTheDocument();
});

it("e-mail invalido nao cria convite", async () => {
  const { invitesApi } = renderPage();
  await openTab("Administração");
  await screen.findByText("Nenhum convite criado ainda.");
  await user.type(field("E-mail da pessoa"), "isso-nao-e-email");
  await user.click(screen.getByRole("button", { name: "Criar convite" }));
  expect(await screen.findByText("Informe um e-mail válido.")).toBeVisible();
  expect(field("E-mail da pessoa")).toHaveFocus();
  expect(invitesApi.writes()).toHaveLength(0);
});

it("criar um convite mostra o link com o codigo uma vez, e o convite entra na lista", async () => {
  const { invitesApi } = renderPage();
  await openTab("Administração");
  await screen.findByText("Nenhum convite criado ainda.");
  await user.type(field("E-mail da pessoa"), "  nova@example.com ");
  await user.click(screen.getByRole("button", { name: "Criar convite" }));
  await waitFor(() => expect(invitesApi.writes()).toHaveLength(1));
  expect(invitesApi.writes()[0]).toMatchObject({ method: "POST", email: "nova@example.com" });
  const link = `${window.location.origin}/register?invite=${invitesApi.state.token}`;
  expect(await screen.findByText(link)).toBeVisible();
  expect(field("E-mail da pessoa")).toHaveValue("");
  expect(await screen.findByText("Vence em 7 dias")).toBeInTheDocument();
});

it("copiar o link usa a area de transferencia e avisa", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const { invitesApi } = renderPage();
  await openTab("Administração");
  await screen.findByText("Nenhum convite criado ainda.");
  await user.type(field("E-mail da pessoa"), "nova@example.com");
  await user.click(screen.getByRole("button", { name: "Criar convite" }));
  await user.click(await screen.findByRole("button", { name: "Copiar link" }));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/register?invite=${invitesApi.state.token}`);
  expect(await screen.findByRole("button", { name: "Copiado" })).toBeInTheDocument();
});

it("sem permissao para copiar, o link continua na tela", async () => {
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: vi.fn(async () => {
        throw new Error("negado");
      }),
    },
    configurable: true,
  });
  renderPage();
  await openTab("Administração");
  await screen.findByText("Nenhum convite criado ainda.");
  await user.type(field("E-mail da pessoa"), "nova@example.com");
  await user.click(screen.getByRole("button", { name: "Criar convite" }));
  await user.click(await screen.findByRole("button", { name: "Copiar link" }));
  expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
  expect(screen.getByText(/\/register\?invite=/)).toBeVisible();
});

it("e-mail que ja tem conta mostra o erro do servidor e nao mostra link", async () => {
  const { invitesApi } = renderPage();
  await openTab("Administração");
  await screen.findByText("Nenhum convite criado ainda.");
  invitesApi.state.nextError = { status: 400, code: "email_already_registered" };
  await user.type(field("E-mail da pessoa"), "ja@example.com");
  await user.click(screen.getByRole("button", { name: "Criar convite" }));
  expect(await screen.findByText("Este e-mail já está cadastrado.")).toBeVisible();
  expect(screen.queryByText(/\/register\?invite=/)).not.toBeInTheDocument();
});

it("revogar pede confirmacao, apaga so o escolhido e tira da lista", async () => {
  const keep = makeInvite({ email: "fica@example.com", expires_at: "2026-03-13T12:00:00Z" });
  const gone = makeInvite({ email: "sai@example.com", expires_at: "2026-03-13T12:00:00Z" });
  const { invitesApi } = renderPage({ invites: [keep, gone] });
  await openTab("Administração");
  await user.click(await screen.findByRole("button", { name: "Revogar o convite de sai@example.com" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("sai@example.com");
  await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(invitesApi.writes()).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Revogar o convite de sai@example.com" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Excluir" }));
  await waitFor(() => expect(invitesApi.writes()).toEqual([{ method: "DELETE", id: gone.id }]));
  await waitFor(() => expect(screen.queryByText("sai@example.com")).not.toBeInTheDocument());
  expect(screen.getByText("fica@example.com")).toBeInTheDocument();
});

it("erro ao carregar os convites tem botao de tentar de novo", async () => {
  const { invitesApi } = renderPage();
  await openTab("Administração");
  await screen.findByText("Nenhum convite criado ainda.");
  invitesApi.state.listError = true;
  // Recarrega a lista criando um convite que falha na listagem seguinte
  invitesApi.state.listError = true;
  await user.type(field("E-mail da pessoa"), "nova@example.com");
  await user.click(screen.getByRole("button", { name: "Criar convite" }));
  const retry = await screen.findByRole("button", { name: "Tentar de novo" });
  invitesApi.state.listError = false;
  await user.click(retry);
  // O convite aparece na lista (e tambem no aviso de convite criado)
  expect((await screen.findAllByText("nova@example.com")).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeInTheDocument();
});

// ---------- Contato de seguranca ----------

const contactField = () => screen.getByLabelText("Contato de segurança", { exact: true }) as HTMLInputElement;

it("so o administrador ve o contato de seguranca, e quem nao e nem le o contato", async () => {
  const { instance } = renderPage({ as: member });
  await screen.findByRole("heading", { name: "Perfil" });
  // Quem nao e admin nem ve a aba Administracao, onde o contato fica
  expect(screen.queryByRole("button", { name: "Administração" })).not.toBeInTheDocument();
  expect(screen.queryByText("Contato de segurança")).not.toBeInTheDocument();
  expect(instance.state.reads).toBe(0);
});

it("o administrador ve o que esta salvo e o endereco onde ele e publicado", async () => {
  renderPage({ contact: "seguranca@example.com" });
  await openTab("Administração");
  await waitFor(() => expect(contactField()).toHaveValue("seguranca@example.com"));
  expect(screen.getByRole("link", { name: "/.well-known/security.txt" })).toHaveAttribute("href", "/.well-known/security.txt");
  expect(screen.getByRole("button", { name: "Remover contato" })).toBeInTheDocument();
});

it("sem contato salvo nao ha Remover nem endereco publicado, e Salvar fica desligado", async () => {
  renderPage();
  await openTab("Administração");
  await waitFor(() => expect(contactField()).toHaveValue(""));
  expect(screen.queryByRole("button", { name: "Remover contato" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "/.well-known/security.txt" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Salvar contato" })).toBeDisabled();
});

it("salvar um e-mail manda o contato sem os espacos das pontas e avisa", async () => {
  const { instance } = renderPage();
  await openTab("Administração");
  await waitFor(() => expect(contactField()).toHaveValue(""));
  await user.type(contactField(), "  seguranca@example.com  ");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));
  await waitFor(() => expect(instance.state.saves).toHaveLength(1));
  expect(instance.state.saves[0]).toEqual({ contact: "seguranca@example.com" });
  expect(await screen.findByText("Contato salvo.")).toBeVisible();
  // O campo passa a mostrar o contato salvo (sem os espacos que a pessoa digitou)
  expect(contactField()).toHaveValue("seguranca@example.com");
  // Depois de salvar nao ha mais o que salvar, e o endereco publicado aparece
  expect(screen.getByRole("button", { name: "Salvar contato" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "/.well-known/security.txt" })).toBeInTheDocument();
});

it("Enter no campo sem nenhuma mudanca nao chama o servidor", async () => {
  const { instance } = renderPage({ contact: "seguranca@example.com" });
  await openTab("Administração");
  await waitFor(() => expect(contactField()).toHaveValue("seguranca@example.com"));
  await user.click(contactField());
  await user.keyboard("{Enter}");
  expect(instance.state.saves).toEqual([]);
  expect(screen.queryByText("Contato salvo.")).not.toBeInTheDocument();
});

it("um endereco https tambem e aceito", async () => {
  const { instance } = renderPage();
  await openTab("Administração");
  await waitFor(() => expect(contactField()).toHaveValue(""));
  await user.type(contactField(), "https://exemplo.com/contato");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));
  await waitFor(() => expect(instance.state.saves).toEqual([{ contact: "https://exemplo.com/contato" }]));
});

it("contato invalido mostra o erro, foca o campo e nao chama o servidor", async () => {
  const { instance } = renderPage();
  await openTab("Administração");
  await waitFor(() => expect(contactField()).toHaveValue(""));
  await user.type(contactField(), "isto nao e um contato");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));
  expect(await screen.findByText("Informe um e-mail válido ou um endereço que comece com https://.")).toBeVisible();
  expect(contactField()).toHaveFocus();
  expect(instance.state.saves).toEqual([]);
});

it("o erro some quando a pessoa volta a digitar", async () => {
  renderPage();
  await openTab("Administração");
  await waitFor(() => expect(contactField()).toHaveValue(""));
  await user.type(contactField(), "nada");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));
  await screen.findByText(/Informe um e-mail válido/);
  await user.type(contactField(), "x");
  expect(screen.queryByText(/Informe um e-mail válido/)).not.toBeInTheDocument();
});

it("Remover contato apaga no servidor e esconde o endereco publicado", async () => {
  const { instance } = renderPage({ contact: "seguranca@example.com" });
  await openTab("Administração");
  await waitFor(() => expect(contactField()).toHaveValue("seguranca@example.com"));
  await user.click(screen.getByRole("button", { name: "Remover contato" }));
  await waitFor(() => expect(instance.state.saves).toEqual([{ contact: null }]));
  expect(await screen.findByText("Contato removido.")).toBeVisible();
  expect(contactField()).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Remover contato" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "/.well-known/security.txt" })).not.toBeInTheDocument();
});

it("apagar o texto e salvar tambem remove o contato", async () => {
  const { instance } = renderPage({ contact: "seguranca@example.com" });
  await openTab("Administração");
  await waitFor(() => expect(contactField()).toHaveValue("seguranca@example.com"));
  await user.clear(contactField());
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));
  await waitFor(() => expect(instance.state.saves).toEqual([{ contact: null }]));
  expect(await screen.findByText("Contato removido.")).toBeVisible();
});

it("trocar o contato por outro manda so o novo", async () => {
  const { instance } = renderPage({ contact: "um@example.com" });
  await openTab("Administração");
  await waitFor(() => expect(contactField()).toHaveValue("um@example.com"));
  await user.clear(contactField());
  await user.type(contactField(), "dois@example.com");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));
  await waitFor(() => expect(instance.state.saves).toEqual([{ contact: "dois@example.com" }]));
  expect(contactField()).toHaveValue("dois@example.com");
});

it("o erro do servidor aparece e o campo continua editavel com o que foi digitado", async () => {
  const { instance } = renderPage();
  await openTab("Administração");
  await waitFor(() => expect(contactField()).toHaveValue(""));
  instance.state.nextError = { status: 403, code: "admin_required" };
  await user.type(contactField(), "seguranca@example.com");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(contactField()).toHaveValue("seguranca@example.com");
  expect(contactField()).toBeEnabled();
  expect(screen.queryByText("Contato salvo.")).not.toBeInTheDocument();
});

it("falha ao ler o contato mostra o erro e deixa tentar de novo", async () => {
  const { instance } = renderPage({ contact: "seguranca@example.com", readError: true });
  await openTab("Administração");
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByLabelText("Contato de segurança", { exact: true })).not.toBeInTheDocument();
  instance.state.readError = false;
  await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
  await waitFor(() => expect(contactField()).toHaveValue("seguranca@example.com"));
});
