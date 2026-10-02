import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBillsApi } from "@/test-utils/bills-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeLabelsApi } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeRecurrencesApi, makeRecurrence, makeTemplateSplit } from "@/test-utils/recurrences-api";
import RecurrencesPage from "./recurrences";

const nubank = makeAccount({ id: "a0000000-0000-4000-8000-000000000001", name: "Nubank" });
const poupanca = makeAccount({ id: "a0000000-0000-4000-8000-000000000002", name: "Poupanca" });

// Data fixa: "em N dias" e a primeira data padrao dependem de hoje
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 15, 12));
});
afterEach(() => vi.useRealTimers());

function renderPage(items = [makeRecurrence({ name: "Aluguel" })]) {
  const api = fakeRecurrencesApi(items);
  server.use(
    ...api.handlers,
    ...fakeAccountsApi([nubank, poupanca]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...fakeBillsApi([]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <RecurrencesPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("li") as HTMLElement;
const openMenu = async (name: string) => {
  await userEvent.click(screen.getByRole("button", { name: `Ações da recorrente ${name}` }));
};
const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());

// ---------- Lista ----------

it("mostra nome, frequencia, descricao com valor, proximo lancamento e fim", async () => {
  renderPage();
  await screen.findByRole("heading", { level: 3, name: "Aluguel" });
  const item = card("Aluguel");
  expect(within(item).getByText("Mensal · Aluguel · R$ 1.500,00")).toBeInTheDocument();
  expect(within(item).getByText("Próximo: 05/04/2026 (em 21 dias)")).toBeInTheDocument();
  expect(within(item).getByText(/Sem data final · 1 criada$/)).toBeInTheDocument();
});

it.each([
  ["2026-03-15", "hoje"],
  ["2026-03-16", "amanhã"],
  ["2026-03-20", "em 5 dias"],
  ["2026-04-14", "em 30 dias"],
])("proximo em %s: %s", async (next, text) => {
  renderPage([makeRecurrence({ name: "X", next_date: next })]);
  await screen.findByText("X");
  expect(within(card("X")).getByText(new RegExp(`\(${text}\)`))).toBeInTheDocument();
});

it("a mais de 30 dias mostra so a data", async () => {
  renderPage([makeRecurrence({ name: "Longe", next_date: "2026-04-15" })]);
  await screen.findByText("Longe");
  expect(within(card("Longe")).getByText("Próximo: 15/04/2026")).toBeInTheDocument();
});

it("fim por data e por numero de vezes", async () => {
  renderPage([
    makeRecurrence({ name: "Ate data", end_date: "2026-12-31" }),
    makeRecurrence({ name: "Doze", max_occurrences: 12, created_count: 3 }),
  ]);
  await screen.findByText("Ate data");
  expect(within(card("Ate data")).getByText("Até 31/12/2026 · 1 criada")).toBeInTheDocument();
  expect(within(card("Doze")).getByText("12 vezes (3 criadas)")).toBeInTheDocument();
});

it("o resumo de um modelo dividido usa o titulo e soma as linhas", async () => {
  renderPage([
    makeRecurrence({
      name: "Mercado",
      template: {
        title: "Compras",
        splits: [
          makeTemplateSplit({ description: "Frutas", amount: "60.00" }),
          makeTemplateSplit({ description: "Limpeza", amount: "40.10" }),
        ],
      },
    }),
  ]);
  await screen.findByText("Mercado");
  expect(within(card("Mercado")).getByText("Mensal · Compras · R$ 100,10")).toBeInTheDocument();
});

it("recorrente terminada mostra Terminou e nao oferece pausar", async () => {
  renderPage([makeRecurrence({ name: "Acabou", ended: true, next_date: null, max_occurrences: 3, created_count: 3 })]);
  await screen.findByText("Acabou");
  expect(within(card("Acabou")).getByText("Terminou", { selector: "span" })).toBeInTheDocument();
  expect(within(card("Acabou")).getByText("Terminou", { selector: "p" })).toBeInTheDocument();
  await openMenu("Acabou");
  expect(screen.queryByRole("menuitem", { name: "Pausar" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Retomar" })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
});

it("falha da ultima tentativa aparece no cartao", async () => {
  renderPage([makeRecurrence({ name: "Quebrada", last_error: "Categoria nao encontrada" })]);
  await screen.findByText("Quebrada");
  expect(within(card("Quebrada")).getByRole("alert")).toHaveTextContent(
    "Não foi possível criar o próximo lançamento: Categoria nao encontrada",
  );
});

it("sem falha nao ha alerta no cartao", async () => {
  renderPage();
  await screen.findByText("Aluguel");
  expect(within(card("Aluguel")).queryByRole("alert")).not.toBeInTheDocument();
});

it("mantem a ordem que o servidor mandou", async () => {
  renderPage([
    makeRecurrence({ name: "Tarde", next_date: "2026-05-01" }),
    makeRecurrence({ name: "Cedo", next_date: "2026-03-20" }),
  ]);
  await screen.findByText("Cedo");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Cedo", "Tarde"]);
});

it("sem recorrentes mostra o estado vazio com a acao de criar", async () => {
  renderPage([]);
  expect(await screen.findByText("Nenhuma recorrente ainda")).toBeInTheDocument();
  const empty = screen.getByText("Nenhuma recorrente ainda").closest("div") as HTMLElement;
  await userEvent.click(within(empty).getByRole("button", { name: /Nova recorrente/ }));
  expect(await screen.findByRole("dialog", { name: "Nova recorrente" })).toBeInTheDocument();
});

it("falha ao carregar mostra o erro e permite tentar de novo", async () => {
  const api = renderPage();
  api.state.listError = true;
  expect(await screen.findByRole("alert")).toBeInTheDocument();

  api.state.listError = false;
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByText("Aluguel")).toBeInTheDocument();
});

// ---------- Pausar ----------

it("pausadas ficam escondidas ate pedir para mostrar", async () => {
  const api = renderPage([makeRecurrence({ name: "Ativa" }), makeRecurrence({ name: "Parada", active: false })]);
  await screen.findByText("Ativa");
  expect(screen.queryByText("Parada")).not.toBeInTheDocument();
  expect(api.listRequests().at(-1)?.query?.get("active")).toBe("true");

  await userEvent.click(screen.getByLabelText("Mostrar pausadas"));
  expect(await screen.findByText("Parada")).toBeInTheDocument();
  expect(within(card("Parada")).getByText("Pausada", { selector: "span" })).toBeInTheDocument();
  expect(within(card("Parada")).getByText("Pausada", { selector: "p" })).toBeInTheDocument();
  expect(api.listRequests().at(-1)?.query?.has("active")).toBe(false);
});

it("pausar manda active falso e a recorrente some da lista", async () => {
  const api = renderPage();
  await screen.findByText("Aluguel");
  await openMenu("Aluguel");
  await userEvent.click(screen.getByRole("menuitem", { name: "Pausar" }));

  await waitFor(() => expect(screen.queryByText("Aluguel")).not.toBeInTheDocument());
  expect(api.mutations()[0]).toMatchObject({ method: "PATCH", body: { active: false } });
});

it("retomar manda active verdadeiro", async () => {
  const api = renderPage([makeRecurrence({ name: "Parada", active: false })]);
  await userEvent.click(await screen.findByLabelText("Mostrar pausadas"));
  await screen.findByText("Parada");
  await openMenu("Parada");
  await userEvent.click(screen.getByRole("menuitem", { name: "Retomar" }));

  await waitFor(() => expect(within(card("Parada")).queryByText("Pausada", { selector: "span" })).not.toBeInTheDocument());
  expect(api.mutations()[0]).toMatchObject({ body: { active: true } });
});

it("falha ao pausar mostra o erro", async () => {
  const api = renderPage();
  await screen.findByText("Aluguel");
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await openMenu("Aluguel");
  await userEvent.click(screen.getByRole("menuitem", { name: "Pausar" }));

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("Aluguel")).toBeInTheDocument();
});

// ---------- Criar ----------

const openCreate = async () => {
  await userEvent.click(await screen.findByRole("button", { name: /Nova recorrente/ }));
  const form = await screen.findByRole("dialog", { name: "Nova recorrente" });
  // Espera as contas chegarem
  await waitFor(() => expect(within(form).getByLabelText("Conta")).toHaveValue(nubank.id));
  return form;
};

const fillBasics = async (name = "Aluguel novo") => {
  await userEvent.type(inDialog().getByLabelText("Nome da recorrente"), name);
  await userEvent.type(inDialog().getByLabelText("Descrição"), "Aluguel do mes");
  await userEvent.type(inDialog().getByLabelText("Para quem"), "Imobiliaria");
  await userEvent.type(inDialog().getByLabelText(/^Valor \(BRL\)/), "1.500");
};

const submit = () => userEvent.click(inDialog().getByRole("button", { name: "Criar recorrente" }));

it("o formulario de nova recorrente tem nome, frequencia e fim, alem dos campos do lancamento", async () => {
  renderPage([makeRecurrence()]);
  await openCreate();
  expect(inDialog().getByLabelText("Nome da recorrente")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Frequência")).toHaveValue("monthly");
  expect(inDialog().getByLabelText("Termina")).toHaveValue("never");
  expect(inDialog().getByLabelText("Primeira data")).toHaveValue("2026-03-15");
  expect(inDialog().getByLabelText("Descrição")).toBeInTheDocument();
  expect(inDialog().queryByLabelText("Data final")).not.toBeInTheDocument();
});

it("cria uma recorrente mensal sem fim, com o modelo montado", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await fillBasics();
  await submit();

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const body = api.mutations()[0].body as Record<string, unknown>;
  expect(body).toMatchObject({
    name: "Aluguel novo",
    frequency: "monthly",
    first_date: "2026-03-15",
    end_date: null,
    max_occurrences: null,
  });
  expect((body.template as { splits: Record<string, unknown>[] }).splits[0]).toMatchObject({
    type: "withdrawal",
    description: "Aluguel do mes",
    amount: "1500.00",
    account_id: nubank.id,
    counterparty_name: "Imobiliaria",
    currency_code: "BRL",
  });
  expect(await screen.findByRole("heading", { level: 3, name: "Aluguel novo" })).toBeInTheDocument();
});

it("a frequencia escolhida vai no corpo", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await fillBasics();
  await userEvent.selectOptions(inDialog().getByLabelText("Frequência"), "Semestral");
  await submit();

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ frequency: "half_yearly" });
});

it("fim numa data manda end_date e zera a contagem", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await fillBasics();
  await userEvent.selectOptions(inDialog().getByLabelText("Termina"), "Numa data");
  setDate("Data final", "2026-12-31");
  await submit();

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ end_date: "2026-12-31", max_occurrences: null });
});

it("fim por quantidade manda max_occurrences como numero", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await fillBasics();
  await userEvent.selectOptions(inDialog().getByLabelText("Termina"), "Depois de N vezes");
  await userEvent.type(inDialog().getByLabelText("Quantas vezes"), "12");
  await submit();

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ end_date: null, max_occurrences: 12 });
});

it("trocar o fim de Numa data para Nunca nao manda a data digitada antes", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await fillBasics();
  await userEvent.selectOptions(inDialog().getByLabelText("Termina"), "Numa data");
  setDate("Data final", "2026-12-31");
  await userEvent.selectOptions(inDialog().getByLabelText("Termina"), "Nunca");
  await submit();

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ end_date: null, max_occurrences: null });
});

it("trocar o fim de volta para Nunca nao manda o valor digitado antes", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await fillBasics();
  await userEvent.selectOptions(inDialog().getByLabelText("Termina"), "Depois de N vezes");
  await userEvent.type(inDialog().getByLabelText("Quantas vezes"), "12");
  await userEvent.selectOptions(inDialog().getByLabelText("Termina"), "Nunca");
  await submit();

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ end_date: null, max_occurrences: null });
});

function setDate(label: string, value: string) {
  const field = inDialog().getByLabelText(label) as HTMLInputElement;
  // userEvent.type em input de data e instavel no jsdom; muda o valor como o navegador faria
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

it("primeira data no passado avisa que os lancamentos ate hoje serao criados", async () => {
  renderPage([makeRecurrence()]);
  await openCreate();
  expect(inDialog().getByText(/Os lançamentos desde esta data até hoje serão criados agora/)).toBeInTheDocument();

  setDate("Primeira data", "2026-04-01");
  await waitFor(() =>
    expect(inDialog().queryByText(/Os lançamentos desde esta data até hoje/)).not.toBeInTheDocument(),
  );
});

it("nome vazio mostra o erro, foca o campo e nao chama a API", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Descrição"), "x");
  await userEvent.type(inDialog().getByLabelText("Para quem"), "y");
  await userEvent.type(inDialog().getByLabelText(/^Valor \(BRL\)/), "10");
  await submit();

  expect(inDialog().getByText("Informe o nome da recorrente.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome da recorrente")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it("erros do lancamento tambem aparecem (descricao, para quem e valor)", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome da recorrente"), "X");
  await submit();

  expect(inDialog().getByText("Informe a descrição.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe para quem foi.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe o valor.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("data final antes da primeira e recusada", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await fillBasics();
  await userEvent.selectOptions(inDialog().getByLabelText("Termina"), "Numa data");
  setDate("Data final", "2026-03-01");
  await submit();

  expect(inDialog().getByText("A data final não pode ser antes da primeira.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("data final vazia e recusada", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await fillBasics();
  await userEvent.selectOptions(inDialog().getByLabelText("Termina"), "Numa data");
  await submit();

  expect(inDialog().getByText("Informe uma data válida.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it.each(["", "0", "abc", "1,5", "100000"])("quantidade %j e recusada", async (value) => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await fillBasics();
  await userEvent.selectOptions(inDialog().getByLabelText("Termina"), "Depois de N vezes");
  if (value) await userEvent.type(inDialog().getByLabelText("Quantas vezes"), value);
  await submit();

  expect(inDialog().getByText("Informe quantas vezes, de 1 a 99999.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("falha do servidor aparece no aviso do topo e nada se perde", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await fillBasics();
  api.state.nextMutationError = { status: 422, code: "recurrence_invalid" };
  await submit();

  expect(await inDialog().findByRole("alert")).toHaveTextContent("Confira o fim da recorrência");
  expect(inDialog().getByLabelText("Nome da recorrente")).toHaveValue("Aluguel novo");
});

it("cancelar fecha sem criar", async () => {
  const api = renderPage([makeRecurrence()]);
  await openCreate();
  await fillBasics();
  await userEvent.click(inDialog().getByRole("button", { name: "Cancelar" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("o formulario de recorrente nao tem o botao de criar lancamento comum", async () => {
  renderPage([makeRecurrence()]);
  await openCreate();
  expect(inDialog().queryByRole("button", { name: "Criar lançamento" })).not.toBeInTheDocument();
  expect(inDialog().getByRole("button", { name: "Criar recorrente" })).toBeInTheDocument();
});

// ---------- Editar ----------

const openEdit = async (name: string) => {
  await openMenu(name);
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  const form = await screen.findByRole("dialog", { name: "Editar recorrente" });
  await waitFor(() => expect(within(form).getByLabelText("Conta")).toHaveValue(nubank.id));
};

it("editar reabre nome, frequencia, primeira data e o modelo, com frequencia e data travadas", async () => {
  renderPage([makeRecurrence({ name: "Aluguel", frequency: "quarterly", first_date: "2026-03-05" })]);
  await screen.findByText("Aluguel");
  await openEdit("Aluguel");

  expect(inDialog().getByLabelText("Nome da recorrente")).toHaveValue("Aluguel");
  expect(inDialog().getByLabelText("Frequência")).toHaveValue("quarterly");
  expect(inDialog().getByLabelText("Frequência")).toBeDisabled();
  expect(inDialog().getByLabelText("Primeira data")).toHaveValue("2026-03-05");
  expect(inDialog().getByLabelText("Primeira data")).toBeDisabled();
  expect(inDialog().getByLabelText("Descrição")).toHaveValue("Aluguel");
  expect(inDialog().getByLabelText("Para quem")).toHaveValue("Imobiliaria");
  expect(inDialog().getByLabelText(/^Valor \(BRL\)/)).toHaveValue("1.500,00".replace(".", ""));
  expect(inDialog().getByLabelText("Termina")).toHaveValue("never");
});

it("editar reabre o fim por quantidade e por data", async () => {
  renderPage([
    makeRecurrence({ name: "Por vezes", max_occurrences: 12 }),
    makeRecurrence({ name: "Por data", end_date: "2026-12-31" }),
  ]);
  await screen.findByText("Por vezes");
  await openEdit("Por vezes");
  expect(inDialog().getByLabelText("Termina")).toHaveValue("count");
  expect(inDialog().getByLabelText("Quantas vezes")).toHaveValue("12");
  await userEvent.click(inDialog().getByRole("button", { name: "Cancelar" }));

  await openEdit("Por data");
  expect(inDialog().getByLabelText("Termina")).toHaveValue("date");
  expect(inDialog().getByLabelText("Data final")).toHaveValue("2026-12-31");
});

it("editar manda nome, modelo e o fim, sem frequencia nem primeira data", async () => {
  const api = renderPage([makeRecurrence({ name: "Aluguel" })]);
  await screen.findByText("Aluguel");
  await openEdit("Aluguel");

  const amount = inDialog().getByLabelText(/^Valor \(BRL\)/);
  await userEvent.clear(amount);
  await userEvent.type(amount, "1800");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  const body = api.mutations()[0].body as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["end_date", "max_occurrences", "name", "template"]);
  expect(body).toMatchObject({ name: "Aluguel", end_date: null, max_occurrences: null });
  expect((body.template as { splits: { amount: string }[] }).splits[0].amount).toBe("1800.00");
  expect(await screen.findByText(/R\$ 1\.800,00/)).toBeInTheDocument();
});

it("salvar sem mexer em nada mantem o modelo igual (inclusive sem bill_id)", async () => {
  const api = renderPage([makeRecurrence({ name: "Aluguel" })]);
  await screen.findByText("Aluguel");
  await openEdit("Aluguel");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  const split = (api.mutations()[0].body as { template: { splits: Record<string, unknown>[] } }).template.splits[0];
  expect(split).not.toHaveProperty("bill_id");
  expect(split).toMatchObject({ description: "Aluguel", amount: "1500.00", counterparty_name: "Imobiliaria" });
});

it("trocar o fim na edicao manda o novo fim", async () => {
  const api = renderPage([makeRecurrence({ name: "Aluguel", max_occurrences: 12 })]);
  await screen.findByText("Aluguel");
  await openEdit("Aluguel");
  await userEvent.selectOptions(inDialog().getByLabelText("Termina"), "Nunca");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ end_date: null, max_occurrences: null });
});

it("modelo que o formulario nao representa mostra o aviso e nao deixa salvar", async () => {
  renderPage([
    makeRecurrence({
      name: "Estranha",
      template: {
        splits: [makeTemplateSplit(), makeTemplateSplit({ account_id: poupanca.id })],
      },
    }),
  ]);
  await screen.findByText("Estranha");
  await openMenu("Estranha");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  const form = await screen.findByRole("dialog", { name: "Editar recorrente" });

  expect(await within(form).findByText(/só pode ser editado pela API/)).toBeInTheDocument();
  expect(within(form).queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
});

// ---------- Excluir ----------

it("excluir pede confirmacao e remove da lista", async () => {
  const api = renderPage([makeRecurrence({ name: "Aluguel" }), makeRecurrence({ name: "Salario" })]);
  await screen.findByText("Aluguel");
  await openMenu("Aluguel");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));

  const confirm = await screen.findByRole("dialog", { name: "Excluir recorrente" });
  expect(confirm).toHaveTextContent("Aluguel");
  expect(confirm).toHaveTextContent("continuam");
  expect(api.mutations()).toHaveLength(0);
  await userEvent.click(within(confirm).getByRole("button", { name: "Excluir" }));

  await waitFor(() => expect(screen.queryByText("Aluguel")).not.toBeInTheDocument());
  expect(api.mutations()[0].method).toBe("DELETE");
  expect(screen.getByText("Salario")).toBeInTheDocument();
});

it("cancelar a exclusao nao apaga nada", async () => {
  const api = renderPage();
  await screen.findByText("Aluguel");
  await openMenu("Aluguel");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));

  expect(api.mutations()).toHaveLength(0);
  expect(screen.getByText("Aluguel")).toBeInTheDocument();
});

it("a concordancia de criada(s) e de vez(es) segue o numero", async () => {
  renderPage([
    makeRecurrence({ name: "Uma", max_occurrences: 1, created_count: 1 }),
    makeRecurrence({ name: "Duas", created_count: 2 }),
  ]);
  await screen.findByText("Uma");
  expect(within(card("Uma")).getByText("1 vez (1 criada)")).toBeInTheDocument();
  expect(within(card("Duas")).getByText(/Sem data final · 2 criadas/)).toBeInTheDocument();
});
