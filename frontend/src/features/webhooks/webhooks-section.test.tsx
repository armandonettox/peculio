import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeWebhooksApi, FAKE_SECRET, makeDelivery, makeWebhook } from "@/test-utils/webhooks-api";
import type { WebhookDelivery } from "@/api/webhooks";
import { WebhooksSection } from "./webhooks-section";

function renderPage(webhooks = [makeWebhook({ name: "Planilha" })], deliveries: Record<string, WebhookDelivery[]> = {}) {
  const api = fakeWebhooksApi(webhooks, deliveries);
  server.use(...api.handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <WebhooksSection />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("li") as HTMLElement;
const openMenu = async (name: string) => {
  await userEvent.click(screen.getByRole("button", { name: `Ações do webhook ${name}` }));
};
const choose = async (name: string, item: string) => {
  await openMenu(name);
  await userEvent.click(screen.getByRole("menuitem", { name: item }));
};
const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());

// ---------- Lista ----------

it("mostra nome, endereco, eventos e a situacao da ultima entrega", async () => {
  renderPage([
    makeWebhook({
      name: "Planilha",
      url: "https://hooks.example.com/planilha",
      events: ["transaction.created", "transaction.deleted"],
      last_delivery_status: "failed",
      last_delivery_at: "2026-03-15T12:00:00Z",
    }),
  ]);
  await screen.findByRole("heading", { level: 3, name: "Planilha" });
  const item = card("Planilha");
  expect(within(item).getByText("https://hooks.example.com/planilha")).toBeInTheDocument();
  expect(within(item).getByText("Lançamento criado")).toBeInTheDocument();
  expect(within(item).getByText("Lançamento excluído")).toBeInTheDocument();
  expect(within(item).queryByText("Lançamento editado")).not.toBeInTheDocument();
  expect(within(item).getByText(/Última entrega: Falhou em/)).toBeInTheDocument();
  expect(within(item).queryByText("Pausado")).not.toBeInTheDocument();
});

it("sem nenhuma entrega diz isso", async () => {
  renderPage();
  await screen.findByText("Planilha");
  expect(within(card("Planilha")).getByText("Nenhuma entrega ainda")).toBeInTheDocument();
});

it("webhook pausado aparece marcado", async () => {
  renderPage([makeWebhook({ name: "Parado", active: false })]);
  await screen.findByText("Parado");
  expect(within(card("Parado")).getByText("Pausado")).toBeInTheDocument();
});

it("mostra o carregando antes da lista chegar", async () => {
  renderPage();
  expect(screen.getByText("Carregando webhooks...")).toBeInTheDocument();
  await screen.findByText("Planilha");
  expect(screen.queryByText("Carregando webhooks...")).not.toBeInTheDocument();
});

it("sem webhooks mostra o estado vazio com a acao de criar", async () => {
  renderPage([]);
  expect(await screen.findByText("Nenhum webhook ainda")).toBeInTheDocument();
  const empty = screen.getByText("Nenhum webhook ainda").closest("div") as HTMLElement;
  await userEvent.click(within(empty).getByRole("button", { name: /Novo webhook/ }));
  expect(await screen.findByRole("dialog", { name: "Novo webhook" })).toBeInTheDocument();
});

it("falha ao carregar mostra o erro e permite tentar de novo", async () => {
  const api = renderPage();
  api.state.listError = true;
  expect(await screen.findByRole("alert")).toBeInTheDocument();

  api.state.listError = false;
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByText("Planilha")).toBeInTheDocument();
});

// ---------- Criar ----------

const openCreate = async () => {
  await userEvent.click(await screen.findByRole("button", { name: /Novo webhook/ }));
  return await screen.findByRole("dialog", { name: "Novo webhook" });
};

it("cria um webhook e mostra o segredo uma unica vez", async () => {
  const api = renderPage([makeWebhook({ name: "Outro" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "  Home Assistant ");
  await userEvent.type(inDialog().getByLabelText("Endereço"), " https://hooks.example.com/ha ");
  await userEvent.click(inDialog().getByLabelText("Lançamento excluído"));
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));

  expect(await screen.findByRole("dialog", { name: "Segredo do webhook" })).toBeInTheDocument();
  expect(api.mutations()[0].body).toEqual({
    name: "Home Assistant",
    url: "https://hooks.example.com/ha",
    events: ["transaction.created", "transaction.deleted"],
    active: true,
  });
  expect(inDialog().getByTestId("webhook-secret")).toHaveTextContent(`${FAKE_SECRET}-1`);
});

it("o dialogo do segredo so fecha depois de marcar que guardou", async () => {
  renderPage([makeWebhook({ name: "Outro" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "Novo");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "https://hooks.example.com/novo");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));
  await screen.findByRole("dialog", { name: "Segredo do webhook" });

  const done = inDialog().getByRole("button", { name: "Concluir" });
  expect(done).toBeDisabled();
  // Esc e clique no X nao fecham
  await userEvent.keyboard("{Escape}");
  await userEvent.click(inDialog().getByRole("button", { name: "Fechar" }));
  expect(screen.getByRole("dialog", { name: "Segredo do webhook" })).toBeInTheDocument();

  await userEvent.click(inDialog().getByLabelText("Guardei o segredo"));
  expect(done).toBeEnabled();
  await userEvent.click(done);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  // Depois de fechar, o segredo nao esta mais na tela
  expect(screen.queryByText(new RegExp(FAKE_SECRET))).not.toBeInTheDocument();
});

it("copiar leva o segredo para a area de transferencia", async () => {
  const user = userEvent.setup();
  renderPage([makeWebhook({ name: "Outro" })]);
  const writeText = vi.spyOn(navigator.clipboard, "writeText");
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "Novo");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "https://hooks.example.com/novo");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));
  await screen.findByRole("dialog", { name: "Segredo do webhook" });

  await user.click(inDialog().getByRole("button", { name: "Copiar" }));
  expect(await inDialog().findByText("Segredo copiado.")).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith(`${FAKE_SECRET}-1`);
});

it("copiar que falha avisa para copiar a mao", async () => {
  const user = userEvent.setup();
  renderPage([makeWebhook({ name: "Outro" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "Novo");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "https://hooks.example.com/novo");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));
  await screen.findByRole("dialog", { name: "Segredo do webhook" });

  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("negado"));
  await user.click(inDialog().getByRole("button", { name: "Copiar" }));
  expect(await inDialog().findByText(/Não foi possível copiar/)).toBeInTheDocument();
});

it("campos vazios mostram os erros, focam o primeiro e nao chamam a API", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.click(inDialog().getByLabelText("Lançamento criado"));
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));

  expect(inDialog().getByText("Informe o nome do webhook.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe o endereço que vai receber os avisos.")).toBeInTheDocument();
  expect(inDialog().getByText("Escolha pelo menos um evento.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

// A mensagem nao pode dizer que so https vale: o formulario aceita http, e o servidor so o libera para
// destinos locais. Fica claro nos dois casos.
const URL_SCHEME_MESSAGE = "O endereço precisa começar com https:// (ou http://, só aceito em destinos locais liberados pelo servidor).";
const DEFAULT_HINT = "Use um endereço https:// público. Endereços da rede interna são recusados.";
const SERVER_URL_MESSAGE =
  "Esse endereço não pode receber webhooks: use um endereço https:// público que responda pela internet, sem usuário e senha na URL.";
const PLAIN_HTTP_HINT = "Endereços http:// só funcionam se o servidor liberar destinos locais. Em uso normal, use https://.";

it("endereco sem http ou https e recusado no campo, que recebe o foco", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "ftp://exemplo.com/x");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));

  expect(inDialog().getByText(URL_SCHEME_MESSAGE)).toBeInTheDocument();
  expect(inDialog().getByLabelText("Endereço")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it("sem evento marcado o foco vai para a primeira caixa", async () => {
  renderPage();
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "https://hooks.example.com/x");
  await userEvent.click(inDialog().getByLabelText("Lançamento criado"));
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));

  expect(inDialog().getByLabelText("Lançamento criado")).toHaveFocus();
});

it("o erro some quando o campo e corrigido", async () => {
  renderPage();
  await openCreate();
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));
  await userEvent.type(inDialog().getByLabelText("Nome"), "a");
  expect(inDialog().queryByText("Informe o nome do webhook.")).not.toBeInTheDocument();
});

it("nome repetido aparece no campo do nome e o dialogo continua aberto", async () => {
  renderPage([makeWebhook({ name: "Planilha" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "planilha");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "https://hooks.example.com/x");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));

  expect(await inDialog().findByText("Já existe um webhook com esse nome.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
});

it("endereco recusado pelo servidor aparece no campo do endereco", async () => {
  const api = renderPage();
  await openCreate();
  api.state.nextMutationError = { status: 422, code: "webhook_url_invalid" };
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "https://10.0.0.1/x");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));

  const message = SERVER_URL_MESSAGE;
  expect(await inDialog().findByText(message)).toBeInTheDocument();
  expect(inDialog().getByLabelText("Endereço")).toHaveFocus();
  expect(inDialog().getByLabelText("Nome")).toHaveValue("X");
});

it("erro de validacao do servidor cai no campo certo", async () => {
  const api = renderPage();
  await openCreate();
  api.state.nextMutationError = {
    status: 422,
    code: "validation_error",
    errors: [{ field: "url", message: "Endereco muito longo" }],
  };
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "https://hooks.example.com/x");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));

  expect(await inDialog().findByText("Endereco muito longo")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Endereço")).toHaveFocus();
});

it("limite de webhooks aparece no aviso do topo", async () => {
  const api = renderPage();
  await openCreate();
  api.state.nextMutationError = { status: 409, code: "webhook_limit_reached" };
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "https://hooks.example.com/x");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));

  expect(await inDialog().findByRole("alert")).toHaveTextContent("limite de 20 webhooks");
});

it("falha do servidor aparece no aviso do topo e nada se perde", async () => {
  const api = renderPage();
  await openCreate();
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "https://hooks.example.com/x");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));

  expect(await inDialog().findByRole("alert")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveValue("X");
});

it("o botao fica desabilitado enquanto envia", async () => {
  const api = renderPage();
  await openCreate();
  api.state.mutationDelayMs = 150;
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "https://hooks.example.com/x");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));

  expect(inDialog().getByRole("button", { name: "Salvando..." })).toBeDisabled();
  await screen.findByRole("dialog", { name: "Segredo do webhook" });
  expect(api.mutations()).toHaveLength(1);
});

it("cancelar fecha sem criar", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.click(inDialog().getByRole("button", { name: "Cancelar" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

// ---------- Editar ----------

const openEdit = async (name: string) => {
  await choose(name, "Editar");
  return await screen.findByRole("dialog", { name: "Editar webhook" });
};

it("editar reabre os campos", async () => {
  renderPage([
    makeWebhook({ name: "Planilha", url: "https://hooks.example.com/p", events: ["transaction.updated"], active: false }),
  ]);
  await screen.findByText("Planilha");
  await openEdit("Planilha");

  expect(inDialog().getByLabelText("Nome")).toHaveValue("Planilha");
  expect(inDialog().getByLabelText("Endereço")).toHaveValue("https://hooks.example.com/p");
  expect(inDialog().getByLabelText("Lançamento criado")).not.toBeChecked();
  expect(inDialog().getByLabelText("Lançamento editado")).toBeChecked();
  expect(inDialog().getByLabelText("Ativo")).not.toBeChecked();
});

const SECRET_URL = "https://maria:s3nh4@hooks.example.com:8443/finance?token=t0k3n-secreto";

it("a lista esconde o token da query e as credenciais do endereco", async () => {
  renderPage([makeWebhook({ name: "Planilha", url: SECRET_URL })]);
  await screen.findByText("Planilha");
  const item = card("Planilha");

  const shown = within(item).getByText("https://***@hooks.example.com:8443/finance?***");
  expect(shown).toHaveAttribute("title", "https://***@hooks.example.com:8443/finance?***");
  // Nem no texto nem em atributo (dica ao passar o mouse) o segredo pode aparecer
  expect(item.innerHTML).not.toMatch(/t0k3n|s3nh4|maria/);
  expect(document.body.innerHTML).not.toMatch(/t0k3n|s3nh4/);
});

it("endereco sem query e sem credenciais aparece como esta", async () => {
  renderPage([makeWebhook({ name: "Planilha", url: "https://hooks.example.com/finance" })]);
  await screen.findByText("Planilha");
  expect(within(card("Planilha")).getByText("https://hooks.example.com/finance")).toBeInTheDocument();
});

it("na edicao o campo mostra o endereco real, com o token", async () => {
  renderPage([makeWebhook({ name: "Planilha", url: SECRET_URL })]);
  await screen.findByText("Planilha");
  await openEdit("Planilha");
  expect(inDialog().getByLabelText("Endereço")).toHaveValue(SECRET_URL);
});

it("editar o nome nao reenvia nem altera o endereco mascarado", async () => {
  const api = renderPage([makeWebhook({ name: "Planilha", url: SECRET_URL })]);
  await screen.findByText("Planilha");
  await openEdit("Planilha");
  await userEvent.clear(inDialog().getByLabelText("Nome"));
  await userEvent.type(inDialog().getByLabelText("Nome"), "Planilha 2");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ name: "Planilha 2" });
});

it("editar manda so o que mudou", async () => {
  const api = renderPage([makeWebhook({ name: "Planilha", events: ["transaction.created"] })]);
  await screen.findByText("Planilha");
  await openEdit("Planilha");
  await userEvent.click(inDialog().getByLabelText("Lançamento editado"));
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0]).toMatchObject({
    method: "PATCH",
    body: { events: ["transaction.created", "transaction.updated"] },
  });
  expect(Object.keys(api.mutations()[0].body ?? {})).toEqual(["events"]);
});

it("salvar sem mudar nada nao chama a API", async () => {
  const api = renderPage();
  await screen.findByText("Planilha");
  await openEdit("Planilha");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(0);
});

it("editar nao mostra segredo", async () => {
  renderPage();
  await screen.findByText("Planilha");
  await openEdit("Planilha");
  await userEvent.clear(inDialog().getByLabelText("Nome"));
  await userEvent.type(inDialog().getByLabelText("Nome"), "Renomeado");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByRole("heading", { level: 3, name: "Renomeado" })).toBeInTheDocument();
  expect(screen.queryByTestId("webhook-secret")).not.toBeInTheDocument();
});

it("editar para um nome que ja existe mostra o erro no campo", async () => {
  renderPage([makeWebhook({ name: "Um" }), makeWebhook({ name: "Dois" })]);
  await screen.findByText("Dois");
  await openEdit("Dois");
  const name = inDialog().getByLabelText("Nome");
  await userEvent.clear(name);
  await userEvent.type(name, "um");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  expect(await inDialog().findByText("Já existe um webhook com esse nome.")).toBeInTheDocument();
  expect(name).toHaveFocus();
});

// ---------- Pausar e retomar ----------

it("pausar manda active falso", async () => {
  const api = renderPage();
  await screen.findByText("Planilha");
  await choose("Planilha", "Pausar");

  await waitFor(() => expect(within(card("Planilha")).getByText("Pausado")).toBeInTheDocument());
  expect(api.mutations()[0]).toMatchObject({ method: "PATCH", body: { active: false } });
});

it("retomar manda active verdadeiro", async () => {
  const api = renderPage([makeWebhook({ name: "Parado", active: false })]);
  await screen.findByText("Parado");
  await choose("Parado", "Retomar");

  await waitFor(() => expect(within(card("Parado")).queryByText("Pausado")).not.toBeInTheDocument());
  expect(api.mutations()[0]).toMatchObject({ body: { active: true } });
});

it("falha ao pausar mostra o erro e o cartao nao muda", async () => {
  const api = renderPage();
  await screen.findByText("Planilha");
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await choose("Planilha", "Pausar");

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(within(card("Planilha")).queryByText("Pausado")).not.toBeInTheDocument();
});

// ---------- Excluir ----------

it("excluir pede confirmacao e remove o cartao", async () => {
  const api = renderPage();
  await screen.findByText("Planilha");
  await choose("Planilha", "Excluir");

  expect(await screen.findByRole("dialog", { name: "Excluir webhook" })).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
  await userEvent.click(inDialog().getByRole("button", { name: "Excluir" }));

  await waitFor(() => expect(screen.queryByText("Planilha")).not.toBeInTheDocument());
  expect(api.mutations()[0]).toMatchObject({ method: "DELETE" });
});

it("cancelar a exclusao nao apaga nada", async () => {
  const api = renderPage();
  await screen.findByText("Planilha");
  await choose("Planilha", "Excluir");
  await userEvent.click(inDialog().getByRole("button", { name: "Cancelar" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("Planilha")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("falha ao excluir mostra o erro no dialogo e o webhook continua", async () => {
  const api = renderPage();
  await screen.findByText("Planilha");
  await choose("Planilha", "Excluir");
  api.state.nextMutationError = { status: 404, code: "webhook_not_found" };
  await userEvent.click(inDialog().getByRole("button", { name: "Excluir" }));

  expect(await inDialog().findByText("Webhook não encontrado.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 3, name: "Planilha", hidden: true })).toBeInTheDocument();
});

// ---------- Girar segredo ----------

it("girar o segredo pede confirmacao e mostra o segredo novo uma unica vez", async () => {
  const api = renderPage();
  await screen.findByText("Planilha");
  await choose("Planilha", "Girar segredo");

  expect(await screen.findByRole("dialog", { name: "Girar segredo" })).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
  await userEvent.click(inDialog().getByRole("button", { name: "Girar segredo" }));

  expect(await screen.findByRole("dialog", { name: "Segredo do webhook" })).toBeInTheDocument();
  expect(inDialog().getByTestId("webhook-secret")).toHaveTextContent(`${FAKE_SECRET}-1`);
  expect(api.mutations()[0]).toMatchObject({ method: "POST", path: expect.stringContaining("/rotate-secret") });
  expect(inDialog().getByRole("button", { name: "Concluir" })).toBeDisabled();
});

it("cancelar a rotacao nao chama a API", async () => {
  const api = renderPage();
  await screen.findByText("Planilha");
  await choose("Planilha", "Girar segredo");
  await userEvent.click(inDialog().getByRole("button", { name: "Cancelar" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("falha ao girar o segredo mostra o erro e nao mostra segredo nenhum", async () => {
  const api = renderPage();
  await screen.findByText("Planilha");
  await choose("Planilha", "Girar segredo");
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await userEvent.click(inDialog().getByRole("button", { name: "Girar segredo" }));

  expect(await inDialog().findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByTestId("webhook-secret")).not.toBeInTheDocument();
});

// ---------- Testar ----------

it("testar mostra o resultado da entrega", async () => {
  const api = renderPage();
  api.state.testResult = { status: "delivered", last_status_code: 200, response_excerpt: "recebido" };
  await screen.findByText("Planilha");
  await choose("Planilha", "Testar");

  expect(await screen.findByRole("dialog", { name: "Teste do webhook" })).toBeInTheDocument();
  expect(await inDialog().findByText("Entregue com sucesso (HTTP 200).")).toBeInTheDocument();
  expect(inDialog().getByText("recebido")).toBeInTheDocument();
  expect(api.mutations()[0]).toMatchObject({ method: "POST", path: expect.stringContaining("/test") });
});

it("teste que falha mostra o codigo, o motivo e o trecho da resposta", async () => {
  const api = renderPage();
  api.state.testResult = {
    status: "failed",
    last_status_code: 500,
    last_error: "Resposta HTTP 500",
    response_excerpt: "erro interno do destino",
  };
  await screen.findByText("Planilha");
  await choose("Planilha", "Testar");

  expect(await inDialog().findByText("Não foi entregue (HTTP 500): Resposta HTTP 500")).toBeInTheDocument();
  expect(inDialog().getByText("erro interno do destino")).toBeInTheDocument();
});

it("teste sem resposta (tempo esgotado) diz que nao houve resposta", async () => {
  const api = renderPage();
  api.state.testResult = {
    status: "failed",
    last_status_code: null,
    last_error: "Tempo esgotado (10 s) esperando a resposta",
  };
  await screen.findByText("Planilha");
  await choose("Planilha", "Testar");

  expect(
    await inDialog().findByText("Não foi entregue (Sem resposta): Tempo esgotado (10 s) esperando a resposta"),
  ).toBeInTheDocument();
});

it("enquanto o teste nao volta mostra que esta enviando", async () => {
  const api = renderPage();
  api.state.testDelayMs = 100;
  await screen.findByText("Planilha");
  await choose("Planilha", "Testar");

  expect(await screen.findByText("Enviando o teste...")).toBeInTheDocument();
  expect(await inDialog().findByText(/Entregue com sucesso/)).toBeInTheDocument();
});

it("erro do servidor no teste aparece no dialogo", async () => {
  const api = renderPage();
  await screen.findByText("Planilha");
  api.state.nextMutationError = { status: 404, code: "webhook_not_found" };
  await choose("Planilha", "Testar");

  expect(await inDialog().findByText("Webhook não encontrado.")).toBeInTheDocument();
});

// ---------- Historico ----------

const history = (count: number, overrides: Partial<WebhookDelivery> = {}) =>
  Array.from({ length: count }, (_, index) => makeDelivery({ ...overrides, attempts: index + 1 }));

it("historico mostra status, tentativas, codigo HTTP e trecho da resposta", async () => {
  const webhook = makeWebhook({ name: "Planilha" });
  renderPage([webhook], {
    [webhook.id]: [
      makeDelivery({
        event: "transaction.deleted",
        status: "failed",
        attempts: 5,
        last_status_code: 503,
        last_error: "Resposta HTTP 503",
        response_excerpt: "fora do ar",
      }),
      makeDelivery({ status: "delivered", attempts: 1, last_status_code: 200 }),
    ],
  });
  await screen.findByText("Planilha");
  await choose("Planilha", "Histórico de entregas");

  expect(await screen.findByRole("dialog", { name: "Histórico de entregas" })).toBeInTheDocument();
  const items = await inDialog().findAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(within(items[0]).getByText("Lançamento excluído")).toBeInTheDocument();
  expect(within(items[0]).getByText("Falhou")).toBeInTheDocument();
  expect(within(items[0]).getByText(/5 tentativas/)).toBeInTheDocument();
  expect(within(items[0]).getByText(/tentativas · HTTP 503/)).toBeInTheDocument();
  expect(within(items[0]).getByText("fora do ar")).toBeInTheDocument();
  expect(within(items[1]).getByText("Entregue")).toBeInTheDocument();
  expect(within(items[1]).getByText(/1 tentativa ·/)).toBeInTheDocument();
});

it("historico mostra a entrega expirada com o motivo e permite filtrar por ela", async () => {
  const webhook = makeWebhook({ name: "Planilha" });
  const api = renderPage([webhook], {
    [webhook.id]: [
      makeDelivery({
        status: "expired",
        attempts: 0,
        last_status_code: null,
        last_error: "Webhook pausado: entrega expirada sem ser enviada",
        delivered_at: null,
      }),
      makeDelivery({ status: "delivered" }),
    ],
  });
  await screen.findByText("Planilha");
  await choose("Planilha", "Histórico de entregas");
  const items = await inDialog().findAllByRole("listitem");
  expect(within(items[0]).getByText("Expirada")).toBeInTheDocument();
  expect(within(items[0]).getByText("Webhook pausado: entrega expirada sem ser enviada")).toBeInTheDocument();

  await userEvent.selectOptions(inDialog().getByLabelText("Situação"), "expired");
  await waitFor(() => expect(api.deliveryRequests().at(-1)?.query?.get("status")).toBe("expired"));
  await waitFor(() => expect(inDialog().getAllByRole("listitem")).toHaveLength(1));
});

it("historico vazio diz que nao ha entregas", async () => {
  renderPage();
  await screen.findByText("Planilha");
  await choose("Planilha", "Histórico de entregas");
  expect(await inDialog().findByText("Nenhuma entrega ainda.")).toBeInTheDocument();
});

it("historico com falha ao carregar permite tentar de novo", async () => {
  const webhook = makeWebhook({ name: "Planilha" });
  const api = renderPage([webhook], { [webhook.id]: [makeDelivery()] });
  api.state.deliveriesError = true;
  await screen.findByText("Planilha");
  await choose("Planilha", "Histórico de entregas");
  expect(await inDialog().findByRole("alert")).toBeInTheDocument();

  api.state.deliveriesError = false;
  await userEvent.click(inDialog().getByRole("button", { name: "Tentar de novo" }));
  expect(await inDialog().findByText("Entregue")).toBeInTheDocument();
});

it("filtrar por situacao pede so aquela situacao", async () => {
  const webhook = makeWebhook({ name: "Planilha" });
  const api = renderPage([webhook], {
    [webhook.id]: [makeDelivery({ status: "failed" }), makeDelivery({ status: "delivered" })],
  });
  await screen.findByText("Planilha");
  await choose("Planilha", "Histórico de entregas");
  await inDialog().findAllByRole("listitem");

  await userEvent.selectOptions(inDialog().getByLabelText("Situação"), "failed");
  await waitFor(() => expect(api.deliveryRequests().at(-1)?.query?.get("status")).toBe("failed"));
  await waitFor(() => expect(inDialog().getAllByRole("listitem")).toHaveLength(1));
  expect(inDialog().getByText("Falhou")).toBeInTheDocument();
});

it("historico longo e paginado", async () => {
  const webhook = makeWebhook({ name: "Planilha" });
  const api = renderPage([webhook], { [webhook.id]: history(12) });
  await screen.findByText("Planilha");
  await choose("Planilha", "Histórico de entregas");

  expect(await inDialog().findAllByRole("listitem")).toHaveLength(10);
  expect(inDialog().getByText("Página 1 de 2")).toBeInTheDocument();
  expect(inDialog().getByRole("button", { name: "Mais recentes" })).toBeDisabled();

  await userEvent.click(inDialog().getByRole("button", { name: "Mais antigas" }));
  await waitFor(() => expect(inDialog().getAllByRole("listitem")).toHaveLength(2));
  expect(api.deliveryRequests().at(-1)?.query?.get("offset")).toBe("10");
  expect(inDialog().getByRole("button", { name: "Mais antigas" })).toBeDisabled();
});

// ---------- Aviso ao digitar http:// ----------

it("o aviso padrao fala de https e rede interna", async () => {
  renderPage();
  await openCreate();
  expect(inDialog().getByText(DEFAULT_HINT)).toBeInTheDocument();
  expect(inDialog().queryByText(PLAIN_HTTP_HINT)).not.toBeInTheDocument();
});

it.each(["http://hooks.example.com/x", "HTTP://hooks.example.com/x"])(
  "digitar %j troca o aviso para o de http, sem bloquear",
  async (typed) => {
    renderPage();
    await openCreate();
    await userEvent.type(inDialog().getByLabelText("Endereço"), typed);
    expect(inDialog().getByText(PLAIN_HTTP_HINT)).toBeInTheDocument();
    expect(inDialog().queryByText(DEFAULT_HINT)).not.toBeInTheDocument();
    expect(inDialog().queryByText(URL_SCHEME_MESSAGE)).not.toBeInTheDocument();
  },
);

it.each(["https://hooks.example.com/x", "httpx://hooks.example.com/x", "ftp://hooks.example.com/x", "hooks.example.com"])(
  "digitar %j mantem o aviso padrao",
  async (typed) => {
    renderPage();
    await openCreate();
    await userEvent.type(inDialog().getByLabelText("Endereço"), typed);
    expect(inDialog().getByText(DEFAULT_HINT)).toBeInTheDocument();
    expect(inDialog().queryByText(PLAIN_HTTP_HINT)).not.toBeInTheDocument();
  },
);

it("o aviso de http volta ao padrao quando a pessoa troca para https", async () => {
  renderPage();
  await openCreate();
  const field = inDialog().getByLabelText("Endereço");
  await userEvent.type(field, "http://hooks.example.com/x");
  expect(inDialog().getByText(PLAIN_HTTP_HINT)).toBeInTheDocument();
  await userEvent.clear(field);
  await userEvent.type(field, "https://hooks.example.com/x");
  expect(inDialog().getByText(DEFAULT_HINT)).toBeInTheDocument();
});

it("um endereco http:// vai ao servidor (quem decide e ele) e a recusa aparece no campo", async () => {
  const api = renderPage();
  await openCreate();
  api.state.nextMutationError = { status: 422, code: "webhook_url_invalid" };
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Endereço"), "http://hooks.example.com/x");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar webhook" }));
  expect(await inDialog().findByText(SERVER_URL_MESSAGE)).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(1);
  expect(api.mutations()[0].body).toMatchObject({ url: "http://hooks.example.com/x" });
});
