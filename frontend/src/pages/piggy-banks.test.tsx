import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { server } from "@/test-utils/msw";
import { fakePiggyBanksApi, makeEvent, makePiggyBank } from "@/test-utils/piggy-banks-api";
import { FakeAuth } from "@/test-utils/providers";
import PiggyBanksPage from "./piggy-banks";

const nubank = makeAccount({ id: "a0000000-0000-4000-8000-000000000001", name: "Nubank" });
const wise = makeAccount({ id: "a0000000-0000-4000-8000-000000000002", name: "Wise", currency_code: "USD" });
const financiamento = makeAccount({
  id: "a0000000-0000-4000-8000-000000000003",
  name: "Financiamento",
  type: "liability",
  role: "mortgage",
});

// Data fixa: a frase da data alvo e o limite do campo de data dependem de hoje
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 15, 12));
});
afterEach(() => vi.useRealTimers());

type Setup = { piggies?: ReturnType<typeof makePiggyBank>[]; events?: Parameters<typeof fakePiggyBanksApi>[1] };

// Aceita so a lista de cofrinhos (o caso comum) ou { piggies, events }
function renderPage(input: Setup | ReturnType<typeof makePiggyBank>[] = {}) {
  const { piggies = [makePiggyBank({ name: "Viagem" })], events }: Setup = Array.isArray(input) ? { piggies: input } : input;
  const api = fakePiggyBanksApi(piggies, events);
  server.use(...api.handlers, ...fakeAccountsApi([nubank, wise, financiamento]).handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <PiggyBanksPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("li") as HTMLElement;
const openMenu = async (name: string, item: string) => {
  await userEvent.click(screen.getByRole("button", { name: `Ações do cofrinho ${name}` }));
  await userEvent.click(screen.getByRole("menuitem", { name: item }));
};
const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());

// ---------- Lista ----------

it("mostra nome, conta, guardado, meta, o que falta e o disponivel na conta", async () => {
  renderPage([makePiggyBank({ name: "Viagem", saved: "150.00", account_available: "850.00" })]);
  await screen.findByRole("heading", { level: 3, name: "Viagem" });
  const item = card("Viagem");
  expect(within(item).getByText("Nubank")).toBeInTheDocument();
  expect(within(item).getByText("R$ 150,00")).toBeInTheDocument();
  expect(within(item).getByText(/de R\$ 600,00/)).toBeInTheDocument();
  expect(within(item).getByText("Faltam R$ 450,00")).toBeInTheDocument();
  expect(within(item).getByText("Disponível em Nubank: R$ 850,00")).toBeInTheDocument();
});

it("a barra informa o percentual a leitores de tela", async () => {
  renderPage([makePiggyBank({ name: "Viagem", saved: "150.00" })]);
  await screen.findByText("Viagem");
  const bar = screen.getByRole("progressbar", { name: "Progresso de Viagem" });
  expect(bar).toHaveAttribute("aria-valuenow", "25");
  expect(bar).toHaveAttribute("aria-valuetext", "25% da meta");
  expect(bar.firstElementChild).toHaveStyle({ width: "25%" });
});

it("meta atingida mostra Meta atingida e a barra cheia, mesmo guardando alem", async () => {
  renderPage([makePiggyBank({ name: "Cheio", saved: "700.00" })]);
  await screen.findByText("Cheio");
  expect(within(card("Cheio")).getByText("Meta atingida")).toBeInTheDocument();
  const bar = within(card("Cheio")).getByRole("progressbar");
  expect(bar).toHaveAttribute("aria-valuenow", "100");
  expect(bar).toHaveAttribute("aria-valuetext", "116% da meta");
});

it("exatamente 100% ja e meta atingida", async () => {
  renderPage([makePiggyBank({ name: "Justo", saved: "600.00" })]);
  await screen.findByText("Justo");
  expect(within(card("Justo")).getByText("Meta atingida")).toBeInTheDocument();
});

it("data alvo com sugestao por mes", async () => {
  renderPage([makePiggyBank({ name: "Viagem", target_date: "2026-09-30", suggested_per_month: "100.00" })]);
  await screen.findByText("Viagem");
  expect(within(card("Viagem")).getByText("Até 30/09/2026 · guarde R$ 100,00 por mês")).toBeInTheDocument();
});

it("data alvo igual a hoje ainda da tempo: nao diz que passou", async () => {
  renderPage([makePiggyBank({ name: "Hoje", target_date: "2026-03-15", suggested_per_month: "50.00" })]);
  await screen.findByText("Hoje");
  expect(within(card("Hoje")).getByText("Até 15/03/2026 · guarde R$ 50,00 por mês")).toBeInTheDocument();
  expect(within(card("Hoje")).queryByText(/A data alvo passou/)).not.toBeInTheDocument();
});

it("a cor da barra muda quando a meta e atingida", async () => {
  renderPage([makePiggyBank({ name: "Andando", saved: "100.00" }), makePiggyBank({ name: "Pronto", saved: "600.00" })]);
  await screen.findByText("Andando");
  const fill = (name: string) => within(card(name)).getByRole("progressbar").firstElementChild;
  expect(fill("Andando")).toHaveClass("bg-primary-text");
  expect(fill("Andando")).not.toHaveClass("bg-positive");
  expect(fill("Pronto")).toHaveClass("bg-positive");
  expect(fill("Pronto")).not.toHaveClass("bg-primary-text");
});

it("data alvo sem sugestao mostra so a data", async () => {
  renderPage([makePiggyBank({ name: "Viagem", target_date: "2026-09-30", suggested_per_month: null })]);
  await screen.findByText("Viagem");
  expect(within(card("Viagem")).getByText("Até 30/09/2026")).toBeInTheDocument();
});

it("data alvo que passou sem chegar a meta avisa", async () => {
  renderPage([makePiggyBank({ name: "Atrasado", target_date: "2026-03-14" })]);
  await screen.findByText("Atrasado");
  expect(within(card("Atrasado")).getByText("A data alvo passou (14/03/2026)")).toBeInTheDocument();
});

it("data alvo que passou mas a meta foi atingida nao avisa", async () => {
  renderPage([makePiggyBank({ name: "Feito", target_date: "2026-03-14", saved: "600.00" })]);
  await screen.findByText("Feito");
  expect(within(card("Feito")).getByText("Até 14/03/2026")).toBeInTheDocument();
});

it("sem data alvo nao ha linha de data", async () => {
  renderPage();
  await screen.findByText("Viagem");
  expect(within(card("Viagem")).queryByText(/Até /)).not.toBeInTheDocument();
});

it("saldo abaixo do reservado mostra alerta com quanto falta cobrir", async () => {
  renderPage([makePiggyBank({ name: "Viagem", saved: "800.00", account_available: "-300.00" })]);
  await screen.findByText("Viagem");
  expect(within(card("Viagem")).getByRole("alert")).toHaveTextContent(
    "O saldo de Nubank está R$ 300,00 abaixo do que está guardado em cofrinhos",
  );
});

it("disponivel positivo nao mostra alerta", async () => {
  renderPage();
  await screen.findByText("Viagem");
  expect(within(card("Viagem")).queryByRole("alert")).not.toBeInTheDocument();
});

it("moeda estrangeira aparece na conta e nos valores", async () => {
  renderPage([makePiggyBank({ name: "Dolar", account_name: "Wise", currency_code: "USD", target_amount: "100.00", saved: "10.00" })]);
  await screen.findByText("Dolar");
  expect(within(card("Dolar")).getByText("Wise · USD")).toBeInTheDocument();
  expect(within(card("Dolar")).getByText("US$ 10,00")).toBeInTheDocument();
});

it("lista em ordem alfabetica", async () => {
  renderPage([makePiggyBank({ name: "Viagem" }), makePiggyBank({ name: "Casa" }), makePiggyBank({ name: "carro" })]);
  await screen.findByText("Casa");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["carro", "Casa", "Viagem"]);
});

it("sem cofrinhos mostra o estado vazio com a acao de criar", async () => {
  renderPage([]);
  expect(await screen.findByText("Nenhum cofrinho ainda")).toBeInTheDocument();
  const empty = screen.getByText("Nenhum cofrinho ainda").closest("div") as HTMLElement;
  await userEvent.click(within(empty).getByRole("button", { name: /Novo cofrinho/ }));
  expect(await screen.findByRole("dialog", { name: "Novo cofrinho" })).toBeInTheDocument();
});

it("falha ao carregar mostra o erro e permite tentar de novo", async () => {
  const api = renderPage();
  api.state.listError = true;
  expect(await screen.findByRole("alert")).toBeInTheDocument();

  api.state.listError = false;
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByText("Viagem")).toBeInTheDocument();
});

// ---------- Criar ----------

const openCreate = async () => {
  await userEvent.click(await screen.findByRole("button", { name: /Novo cofrinho/ }));
  const form = await screen.findByRole("dialog", { name: "Novo cofrinho" });
  await waitFor(() => expect(within(form).getAllByRole("option").length).toBeGreaterThan(1));
  return form;
};

function setDate(label: string, value: string) {
  const field = inDialog().getByLabelText(label) as HTMLInputElement;
  // userEvent.type em input de data e instavel no jsdom; muda o valor como o navegador faria
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

it("a lista de contas do formulario tem so contas de ativos", async () => {
  renderPage();
  await openCreate();
  const options = within(inDialog().getByLabelText("Conta")).getAllByRole("option").map((o) => o.textContent);
  expect(options).toEqual(["Escolha...", "Nubank", "Wise - USD"]);
});

it("cria um cofrinho com meta e data alvo", async () => {
  const api = renderPage([makePiggyBank({ name: "Outro" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "  Reserva ");
  await userEvent.selectOptions(inDialog().getByLabelText("Conta"), "Nubank");
  await userEvent.type(inDialog().getByLabelText(/^Valor da meta/), "10.000,50");
  setDate("Data alvo (opcional)", "2026-12-31");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar cofrinho" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()[0].body).toEqual({
    name: "Reserva",
    account_id: nubank.id,
    target_amount: "10000.50",
    target_date: "2026-12-31",
  });
  expect(await screen.findByRole("heading", { level: 3, name: "Reserva" })).toBeInTheDocument();
});

it("sem data alvo manda null", async () => {
  const api = renderPage([makePiggyBank({ name: "Outro" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "Reserva");
  await userEvent.selectOptions(inDialog().getByLabelText("Conta"), "Nubank");
  await userEvent.type(inDialog().getByLabelText(/^Valor da meta/), "500");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar cofrinho" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ target_date: null });
});

it("o rotulo do valor mostra a moeda da conta escolhida", async () => {
  renderPage();
  await openCreate();
  expect(inDialog().getByLabelText("Valor da meta (BRL)")).toBeInTheDocument();
  await userEvent.selectOptions(inDialog().getByLabelText("Conta"), "Wise - USD");
  expect(inDialog().getByLabelText("Valor da meta (USD)")).toBeInTheDocument();
});

it("campos vazios mostram os erros, focam o primeiro e nao chamam a API", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.click(inDialog().getByRole("button", { name: "Criar cofrinho" }));

  expect(inDialog().getByText("Informe o nome do cofrinho.")).toBeInTheDocument();
  expect(inDialog().getByText("Escolha a conta.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe o valor da meta.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it.each([
  ["0", "Informe um valor maior que zero."],
  ["-5", "Informe um valor maior que zero."],
  ["abc", "Valor inválido."],
  ["10,555", "Use no máximo 2 casas decimais."],
])("valor da meta %j mostra %j", async (value, message) => {
  const api = renderPage();
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.selectOptions(inDialog().getByLabelText("Conta"), "Nubank");
  await userEvent.type(inDialog().getByLabelText(/^Valor da meta/), value);
  await userEvent.click(inDialog().getByRole("button", { name: "Criar cofrinho" }));

  expect(inDialog().getByText(message)).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("nome repetido aparece no campo do nome e o dialogo continua aberto", async () => {
  renderPage([makePiggyBank({ name: "Viagem" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "viagem");
  await userEvent.selectOptions(inDialog().getByLabelText("Conta"), "Nubank");
  await userEvent.type(inDialog().getByLabelText(/^Valor da meta/), "100");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar cofrinho" }));

  expect(await inDialog().findByText("Já existe um cofrinho com esse nome.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
});

it("falha do servidor aparece no aviso do topo e nada se perde", async () => {
  const api = renderPage();
  await openCreate();
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.selectOptions(inDialog().getByLabelText("Conta"), "Nubank");
  await userEvent.type(inDialog().getByLabelText(/^Valor da meta/), "100");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar cofrinho" }));

  expect(await inDialog().findByRole("alert")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveValue("X");
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
  await openMenu(name, "Editar");
  return await screen.findByRole("dialog", { name: "Editar cofrinho" });
};

it("editar reabre os campos, com a conta travada", async () => {
  renderPage([makePiggyBank({ name: "Viagem", target_amount: "1234.50", target_date: "2026-12-31" })]);
  await screen.findByText("Viagem");
  await openEdit("Viagem");

  expect(inDialog().getByLabelText("Nome")).toHaveValue("Viagem");
  expect(inDialog().getByLabelText("Conta")).toBeDisabled();
  expect(inDialog().getByLabelText("Conta")).toHaveDisplayValue("Nubank");
  expect(inDialog().getByLabelText(/^Valor da meta/)).toHaveValue("1234,50");
  expect(inDialog().getByLabelText("Data alvo (opcional)")).toHaveValue("2026-12-31");
});

it("editar manda so o que mudou", async () => {
  const api = renderPage([makePiggyBank({ name: "Viagem", target_date: "2026-12-31" })]);
  await screen.findByText("Viagem");
  await openEdit("Viagem");
  const amount = inDialog().getByLabelText(/^Valor da meta/);
  await userEvent.clear(amount);
  await userEvent.type(amount, "900");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ target_amount: "900.00" });
});

it("apagar a data alvo manda null", async () => {
  const api = renderPage([makePiggyBank({ name: "Viagem", target_date: "2026-12-31" })]);
  await screen.findByText("Viagem");
  await openEdit("Viagem");
  setDate("Data alvo (opcional)", "");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ target_date: null });
});

it("salvar sem mudar nada nao chama a API", async () => {
  const api = renderPage([makePiggyBank({ name: "Viagem", target_date: "2026-12-31" })]);
  await screen.findByText("Viagem");
  await openEdit("Viagem");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(0);
});

// ---------- Guardar e retirar ----------

it("guardar manda kind add, o valor, a data de hoje e a nota", async () => {
  const api = renderPage([makePiggyBank({ name: "Viagem" })]);
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Guardar");

  expect(inDialog().getByLabelText("Data")).toHaveValue("2026-03-15");
  expect(dialog()).toHaveTextContent("Disponível agora: R$ 1.000,00");
  await userEvent.type(inDialog().getByLabelText(/^Valor/), "150,50");
  await userEvent.type(inDialog().getByLabelText("Nota (opcional)"), "  Bonus ");
  await userEvent.click(inDialog().getByRole("button", { name: "Guardar" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()[0].body).toEqual({ kind: "add", amount: "150.50", date: "2026-03-15", note: "Bonus" });
  expect(await within(card("Viagem")).findByText("R$ 150,50")).toBeInTheDocument();
  expect(within(card("Viagem")).getByText("Disponível em Nubank: R$ 849,50")).toBeInTheDocument();
});

it("sem nota manda null", async () => {
  const api = renderPage();
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Guardar");
  await userEvent.type(inDialog().getByLabelText(/^Valor/), "10");
  await userEvent.click(inDialog().getByRole("button", { name: "Guardar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ note: null });
});

it("passar do disponivel mostra o erro no campo do valor e nada muda", async () => {
  const api = renderPage([makePiggyBank({ name: "Viagem", account_available: "100.00" })]);
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Guardar");
  await userEvent.type(inDialog().getByLabelText(/^Valor/), "100,01");
  await userEvent.click(inDialog().getByRole("button", { name: "Guardar" }));

  expect(await inDialog().findByText(/A conta não tem esse valor disponível/)).toBeInTheDocument();
  expect(inDialog().getByLabelText(/^Valor/)).toHaveFocus();
  // A chamada foi feita e recusada: nada foi guardado (a pagina atras do dialogo fica escondida das consultas)
  expect(api.mutations()).toHaveLength(1);
  expect(api.state.piggies[0].saved).toBe("0.00");
});

it("retirar manda kind remove e devolve ao disponivel", async () => {
  const api = renderPage([makePiggyBank({ name: "Viagem", saved: "300.00", account_available: "700.00" })]);
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Retirar");

  expect(dialog()).toHaveTextContent("Guardado agora: R$ 300,00");
  await userEvent.type(inDialog().getByLabelText(/^Valor/), "100");
  await userEvent.click(inDialog().getByRole("button", { name: "Retirar" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()[0].body).toMatchObject({ kind: "remove", amount: "100.00" });
  expect(await within(card("Viagem")).findByText("Disponível em Nubank: R$ 800,00")).toBeInTheDocument();
});

it("retirar mais do que ha guardado mostra o erro no campo", async () => {
  renderPage([makePiggyBank({ name: "Viagem", saved: "50.00" })]);
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Retirar");
  await userEvent.type(inDialog().getByLabelText(/^Valor/), "50,01");
  await userEvent.click(inDialog().getByRole("button", { name: "Retirar" }));

  expect(await inDialog().findByText("O cofrinho não tem esse valor guardado.")).toBeInTheDocument();
});

it("valor vazio, zero e invalido sao recusados sem chamar a API", async () => {
  const api = renderPage();
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Guardar");

  await userEvent.click(inDialog().getByRole("button", { name: "Guardar" }));
  expect(inDialog().getByText("Informe o valor.")).toBeInTheDocument();

  await userEvent.type(inDialog().getByLabelText(/^Valor/), "0");
  await userEvent.click(inDialog().getByRole("button", { name: "Guardar" }));
  expect(inDialog().getByText("Informe um valor maior que zero.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("data no futuro e recusada", async () => {
  const api = renderPage();
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Guardar");
  await userEvent.type(inDialog().getByLabelText(/^Valor/), "10");
  setDate("Data", "2026-03-16");
  await userEvent.click(inDialog().getByRole("button", { name: "Guardar" }));

  expect(inDialog().getByText("A data não pode ser no futuro.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Data")).toHaveAttribute("max", "2026-03-15");
  expect(api.mutations()).toHaveLength(0);
});

it("falha do servidor ao guardar aparece no aviso do topo", async () => {
  const api = renderPage();
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Guardar");
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await userEvent.type(inDialog().getByLabelText(/^Valor/), "10");
  await userEvent.click(inDialog().getByRole("button", { name: "Guardar" }));

  expect(await inDialog().findByRole("alert")).toBeInTheDocument();
  expect(inDialog().getByLabelText(/^Valor/)).toHaveValue("10");
});

// ---------- Historico ----------

it("historico lista os movimentos com sinal, data e nota", async () => {
  const piggy = makePiggyBank({ name: "Viagem" });
  renderPage({
    piggies: [piggy],
    events: {
      [piggy.id]: [
        makeEvent({ kind: "remove", amount: "30.00", date: "2026-03-12" }),
        makeEvent({ kind: "add", amount: "100.00", date: "2026-03-10", note: "Bonus" }),
      ],
    },
  });
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Histórico");

  const list = await inDialog().findByRole("list", { name: "Movimentos" });
  // O Intl usa espaco sem quebra entre o simbolo e o numero; comparamos com espaco comum
  const rows = within(list).getAllByRole("listitem").map((row) => (row.textContent ?? "").replace(/\s+/g, " "));
  expect(rows[0]).toContain("Retirou");
  expect(rows[0]).toContain("− R$ 30,00");
  expect(rows[0]).toContain("12/03/2026");
  expect(rows[1]).toContain("Guardou");
  expect(rows[1]).toContain("+ R$ 100,00");
  expect(rows[1]).toContain("Bonus");
});

it("historico vazio avisa", async () => {
  renderPage();
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Histórico");
  expect(await inDialog().findByText("Ainda não há movimentos neste cofrinho.")).toBeInTheDocument();
});

it("historico com mais de 50 movimentos avisa que mostra so os mais recentes", async () => {
  const piggy = makePiggyBank({ name: "Viagem" });
  const api = renderPage({ piggies: [piggy], events: { [piggy.id]: [makeEvent()] } });
  api.state.eventsTotal = 120;
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Histórico");
  expect(await inDialog().findByText("Mostrando os 50 mais recentes de 120.")).toBeInTheDocument();
});

it("falha ao carregar o historico mostra o erro", async () => {
  const api = renderPage();
  api.state.eventsError = true;
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Histórico");
  expect(await inDialog().findByRole("alert")).toBeInTheDocument();
});

// ---------- Excluir ----------

it("excluir pede confirmacao, avisa que o valor volta ao disponivel e remove da lista", async () => {
  const api = renderPage([makePiggyBank({ name: "Viagem" }), makePiggyBank({ name: "Casa" })]);
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Excluir");

  const confirm = await screen.findByRole("dialog", { name: "Excluir cofrinho" });
  expect(confirm).toHaveTextContent("Viagem");
  expect(confirm).toHaveTextContent("volta a ficar disponível na conta");
  expect(api.mutations()).toHaveLength(0);
  await userEvent.click(within(confirm).getByRole("button", { name: "Excluir" }));

  await waitFor(() => expect(screen.queryByText("Viagem")).not.toBeInTheDocument());
  expect(api.mutations()[0].method).toBe("DELETE");
  expect(screen.getByText("Casa")).toBeInTheDocument();
});

it("cancelar a exclusao nao apaga nada", async () => {
  const api = renderPage();
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Excluir");
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));

  expect(api.mutations()).toHaveLength(0);
  expect(screen.getByText("Viagem")).toBeInTheDocument();
});

// ---------- Arquivar ----------

it("arquivados ficam escondidos e aparecem com o aviso ao marcar Mostrar arquivados", async () => {
  const api = renderPage([
    makePiggyBank({ name: "Viagem" }),
    makePiggyBank({ name: "Antigo", saved: "300.00", active: false }),
  ]);
  await screen.findByText("Viagem");
  expect(screen.queryByText("Antigo")).not.toBeInTheDocument();
  expect(api.state.requests.at(-1)?.query?.get("active")).toBe("true");

  await userEvent.click(screen.getByLabelText("Mostrar arquivados"));
  expect(await screen.findByText("Antigo")).toBeInTheDocument();
  expect(within(card("Antigo")).getByText("Arquivado", { selector: "span" })).toBeInTheDocument();
  expect(
    within(card("Antigo")).getByText("Arquivado: o valor guardado continua reservado na conta. Retire para liberar."),
  ).toBeInTheDocument();
  expect(within(card("Viagem")).queryByText("Arquivado", { selector: "span" })).not.toBeInTheDocument();
  expect(api.state.requests.at(-1)?.query?.has("active")).toBe(false);
});

it("arquivar manda active falso e o cofrinho some da lista", async () => {
  const api = renderPage([makePiggyBank({ name: "Viagem" }), makePiggyBank({ name: "Carro" })]);
  await screen.findByText("Viagem");
  await openMenu("Viagem", "Arquivar");
  await waitFor(() => expect(screen.queryByText("Viagem")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(1);
  expect(api.mutations()[0].method).toBe("PATCH");
  expect(api.mutations()[0].body).toEqual({ active: false });
  expect(screen.getByText("Carro")).toBeInTheDocument();
});

it("desarquivar manda active verdadeiro e tira o selo", async () => {
  const api = renderPage([makePiggyBank({ name: "Antigo", active: false })]);
  await userEvent.click(await screen.findByLabelText("Mostrar arquivados"));
  await screen.findByText("Antigo");
  await openMenu("Antigo", "Desarquivar");
  await waitFor(() =>
    expect(within(card("Antigo")).queryByText("Arquivado", { selector: "span" })).not.toBeInTheDocument(),
  );
  expect(api.mutations()[0].body).toEqual({ active: true });
});

it("cofrinho arquivado nao oferece Guardar, mas deixa retirar para liberar o valor", async () => {
  renderPage([makePiggyBank({ name: "Antigo", saved: "300.00", active: false })]);
  await userEvent.click(await screen.findByLabelText("Mostrar arquivados"));
  await screen.findByText("Antigo");
  await userEvent.click(screen.getByRole("button", { name: "Ações do cofrinho Antigo" }));
  expect(screen.queryByRole("menuitem", { name: "Guardar" })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Retirar" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Desarquivar" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Arquivar" })).not.toBeInTheDocument();
});

it("falha ao arquivar aparece no aviso do topo e o cofrinho continua na lista", async () => {
  const api = renderPage([makePiggyBank({ name: "Viagem" })]);
  await screen.findByText("Viagem");
  api.state.nextMutationError = { status: 404, code: "piggy_bank_not_found" };
  await openMenu("Viagem", "Arquivar");
  expect(await screen.findByRole("alert")).toHaveTextContent("Cofrinho não encontrado.");
  expect(screen.getByText("Viagem")).toBeInTheDocument();
});
