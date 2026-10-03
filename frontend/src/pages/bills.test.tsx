import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { syncAppClock } from "@/lib/app-clock";
import { fakeAccountsApi } from "@/test-utils/accounts-api";
import { fakeBillsApi, makeBill } from "@/test-utils/bills-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import BillsPage from "./bills";

// Data fixa: "em N dias" depende de hoje
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 15, 12));
});
afterEach(() => vi.useRealTimers());

function renderPage(bills = [makeBill({ name: "Netflix" })]) {
  const api = fakeBillsApi(bills);
  server.use(...api.handlers, ...fakeAccountsApi([]).handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("li") as HTMLElement;
const openMenu = async (name: string) => {
  await userEvent.click(screen.getByRole("button", { name: `Ações da conta a pagar ${name}` }));
};
const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());

// ---------- Lista ----------

it("mostra nome, frequencia, faixa de valor e proximo vencimento", async () => {
  renderPage();
  await screen.findByRole("heading", { level: 3, name: "Netflix" });
  const item = card("Netflix");
  expect(within(item).getByText("Mensal · R$ 40,00 a R$ 60,00")).toBeInTheDocument();
  expect(within(item).getByText("Próximo vencimento: 05/04/2026 (em 21 dias)")).toBeInTheDocument();
  expect(within(item).getByText("Liga sozinha quando contém “netflix”")).toBeInTheDocument();
});

it("valor fixo aparece uma vez so", async () => {
  renderPage([makeBill({ name: "Aluguel", amount_min: "1500.00", amount_max: "1500.00", frequency: "monthly" })]);
  await screen.findByText("Aluguel");
  expect(within(card("Aluguel")).getByText("Mensal · R$ 1.500,00")).toBeInTheDocument();
});

it("conta paga mostra Pago", async () => {
  renderPage([makeBill({ name: "Paga", status: "paid" })]);
  await screen.findByText("Paga");
  expect(within(card("Paga")).getByText("Pago")).toBeInTheDocument();
});

it("conta atrasada mostra Atrasada e a data em que venceu", async () => {
  renderPage([makeBill({ name: "Atrasada", status: "overdue", last_due_date: "2026-03-05" })]);
  await screen.findByText("Atrasada");
  expect(within(card("Atrasada")).getByText("Atrasada · venceu em 05/03/2026")).toBeInTheDocument();
});

it("conta cujo primeiro vencimento ainda nao chegou mostra A vencer", async () => {
  renderPage([makeBill({ name: "Futura", status: "upcoming", last_due_date: null, next_due_date: "2026-03-25" })]);
  await screen.findByText("Futura");
  expect(within(card("Futura")).getByText("A vencer")).toBeInTheDocument();
  expect(within(card("Futura")).getByText("Próximo vencimento: 25/03/2026 (em 10 dias)")).toBeInTheDocument();
});

it("proximo vencimento pago adiantado aparece marcado", async () => {
  renderPage([makeBill({ name: "Adiantada", status: "overdue", next_due_paid: true })]);
  await screen.findByText("Adiantada");
  expect(within(card("Adiantada")).getByText(/já pago/)).toBeInTheDocument();
});

it("sem texto para ligar mostra que so liga a mao", async () => {
  renderPage([makeBill({ name: "Manual", match_text: null })]);
  await screen.findByText("Manual");
  expect(within(card("Manual")).getByText("Sem ligação automática")).toBeInTheDocument();
});

it.each([
  ["2026-03-15", "hoje"],
  ["2026-03-16", "amanhã"],
  ["2026-03-20", "em 5 dias"],
  ["2026-04-14", "em 30 dias"],
])("vence em %s: %s", async (next, text) => {
  renderPage([makeBill({ name: "X", next_due_date: next })]);
  await screen.findByText("X");
  expect(within(card("X")).getByText(new RegExp(`\\(${text}\\)`))).toBeInTheDocument();
});

it("vencimento a mais de 30 dias mostra so a data", async () => {
  renderPage([makeBill({ name: "Longe", next_due_date: "2026-04-15" })]);
  await screen.findByText("Longe");
  expect(within(card("Longe")).getByText("Próximo vencimento: 15/04/2026")).toBeInTheDocument();
});

it("moeda estrangeira aparece no valor e na linha da frequencia", async () => {
  renderPage([makeBill({ name: "Dolar", currency_code: "USD", amount_min: "10.00", amount_max: "10.00" })]);
  await screen.findByText("Dolar");
  expect(within(card("Dolar")).getByText("Mensal · US$ 10,00 · USD")).toBeInTheDocument();
});

it("mantem a ordem que o servidor mandou (proximo vencimento)", async () => {
  renderPage([
    makeBill({ name: "Tarde", next_due_date: "2026-03-25" }),
    makeBill({ name: "Cedo", next_due_date: "2026-03-16" }),
    makeBill({ name: "Meio", next_due_date: "2026-03-20" }),
  ]);
  await screen.findByText("Cedo");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Cedo", "Meio", "Tarde"]);
});

it("sem contas mostra o estado vazio com a acao de criar", async () => {
  renderPage([]);
  expect(await screen.findByText("Nenhuma conta a pagar ainda")).toBeInTheDocument();
  const empty = screen.getByText("Nenhuma conta a pagar ainda").closest("div") as HTMLElement;
  await userEvent.click(within(empty).getByRole("button", { name: /Nova conta a pagar/ }));
  expect(await screen.findByRole("dialog", { name: "Nova conta a pagar" })).toBeInTheDocument();
});

it("falha ao carregar mostra o erro e permite tentar de novo", async () => {
  const api = renderPage([makeBill({ name: "Netflix" })]);
  api.state.listError = true;
  expect(await screen.findByRole("alert")).toBeInTheDocument();

  api.state.listError = false;
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByText("Netflix")).toBeInTheDocument();
});

it("pede a situacao de hoje", async () => {
  const api = renderPage();
  await screen.findByText("Netflix");
  expect(api.statusRequests().at(-1)?.query?.get("on")).toBe("2026-03-15");
});

// ---------- Arquivadas ----------

it("arquivadas ficam escondidas ate pedir para mostrar", async () => {
  const api = renderPage([makeBill({ name: "Ativa" }), makeBill({ name: "Velha", active: false })]);
  await screen.findByText("Ativa");
  expect(screen.queryByText("Velha")).not.toBeInTheDocument();
  expect(api.statusRequests().at(-1)?.query?.get("include_archived")).toBe("false");

  await userEvent.click(screen.getByLabelText("Mostrar arquivadas"));
  expect(await screen.findByText("Velha")).toBeInTheDocument();
  expect(within(card("Velha")).getByText("Arquivada")).toBeInTheDocument();
  expect(api.statusRequests().at(-1)?.query?.get("include_archived")).toBe("true");
});

it("arquivar manda active falso e a conta some da lista", async () => {
  const api = renderPage([makeBill({ name: "Netflix" })]);
  await screen.findByText("Netflix");
  await openMenu("Netflix");
  await userEvent.click(screen.getByRole("menuitem", { name: "Arquivar" }));

  await waitFor(() => expect(screen.queryByText("Netflix")).not.toBeInTheDocument());
  expect(api.mutations()[0]).toMatchObject({ method: "PATCH", body: { active: false } });
});

it("restaurar uma arquivada manda active verdadeiro", async () => {
  const api = renderPage([makeBill({ name: "Velha", active: false })]);
  await userEvent.click(await screen.findByLabelText("Mostrar arquivadas"));
  await screen.findByText("Velha");
  await openMenu("Velha");
  await userEvent.click(screen.getByRole("menuitem", { name: "Restaurar" }));

  await waitFor(() => expect(within(card("Velha")).queryByText("Arquivada")).not.toBeInTheDocument());
  expect(api.mutations()[0]).toMatchObject({ body: { active: true } });
});

it("falha ao arquivar mostra o erro", async () => {
  const api = renderPage();
  await screen.findByText("Netflix");
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await openMenu("Netflix");
  await userEvent.click(screen.getByRole("menuitem", { name: "Arquivar" }));

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("Netflix")).toBeInTheDocument();
});

// ---------- Criar ----------

const openCreate = async () => {
  await userEvent.click(await screen.findByRole("button", { name: /Nova conta a pagar/ }));
  return await screen.findByRole("dialog", { name: "Nova conta a pagar" });
};

it("cria uma conta com faixa de valor, texto e frequencia", async () => {
  const api = renderPage([makeBill({ name: "Outra" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "  Spotify ");
  await userEvent.type(inDialog().getByLabelText("Valor mínimo"), "19,90");
  await userEvent.type(inDialog().getByLabelText("Valor máximo"), "24,90");
  await userEvent.type(inDialog().getByLabelText("Texto para ligar sozinho"), " spotify ");
  await userEvent.selectOptions(inDialog().getByLabelText("Frequência"), "Anual");
  fireDate("2026-05-10");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar conta a pagar" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()[0].body).toEqual({
    name: "Spotify",
    currency_code: "BRL",
    amount_min: "19.90",
    amount_max: "24.90",
    match_text: "spotify",
    first_due_date: "2026-05-10",
    frequency: "yearly",
  });
  expect(await screen.findByRole("heading", { level: 3, name: "Spotify" })).toBeInTheDocument();
});

function fireDate(value: string) {
  const field = inDialog().getByLabelText("Primeiro vencimento") as HTMLInputElement;
  // userEvent.type em input de data e instavel no jsdom; muda o valor como o navegador faria
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

it("sem valor maximo a conta tem preco fixo (maximo igual ao minimo)", async () => {
  const api = renderPage([makeBill({ name: "Outra" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "Aluguel");
  await userEvent.type(inDialog().getByLabelText("Valor mínimo"), "1.500");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar conta a pagar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ amount_min: "1500.00", amount_max: "1500.00", match_text: null });
});

it("o primeiro vencimento comeca em hoje", async () => {
  renderPage([makeBill()]);
  await openCreate();
  expect(inDialog().getByLabelText("Primeiro vencimento")).toHaveValue("2026-03-15");
});

it("campos vazios mostram os erros, focam o primeiro e nao chamam a API", async () => {
  const api = renderPage([makeBill()]);
  await openCreate();
  await userEvent.click(inDialog().getByRole("button", { name: "Criar conta a pagar" }));

  expect(inDialog().getByText("Informe o nome da conta.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe o valor.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it.each([
  ["0", "Informe um valor maior que zero."],
  ["-5", "Informe um valor maior que zero."],
  ["abc", "Valor inválido."],
  ["10,555", "Use no máximo 2 casas decimais."],
])("valor minimo %j mostra %j", async (value, message) => {
  const api = renderPage([makeBill()]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Valor mínimo"), value);
  await userEvent.click(inDialog().getByRole("button", { name: "Criar conta a pagar" }));

  expect(inDialog().getByText(message)).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("valor maximo menor que o minimo e recusado no campo do maximo", async () => {
  const api = renderPage([makeBill()]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Valor mínimo"), "50");
  await userEvent.type(inDialog().getByLabelText("Valor máximo"), "49,99");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar conta a pagar" }));

  expect(inDialog().getByText("O valor máximo não pode ser menor que o mínimo.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("maximo igual ao minimo e aceito", async () => {
  const api = renderPage([makeBill()]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Valor mínimo"), "50");
  await userEvent.type(inDialog().getByLabelText("Valor máximo"), "50,00");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar conta a pagar" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
});

it("data apagada e recusada", async () => {
  const api = renderPage([makeBill()]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Valor mínimo"), "50");
  fireDate("");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar conta a pagar" }));

  expect(inDialog().getByText("Informe uma data válida.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("o erro some quando o campo e corrigido", async () => {
  renderPage([makeBill()]);
  await openCreate();
  await userEvent.click(inDialog().getByRole("button", { name: "Criar conta a pagar" }));
  await userEvent.type(inDialog().getByLabelText("Nome"), "a");
  expect(inDialog().queryByText("Informe o nome da conta.")).not.toBeInTheDocument();
});

it("nome repetido aparece no campo do nome e o dialogo continua aberto", async () => {
  renderPage([makeBill({ name: "Netflix" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "netflix");
  await userEvent.type(inDialog().getByLabelText("Valor mínimo"), "10");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar conta a pagar" }));

  expect(await inDialog().findByText("Já existe uma conta a pagar com esse nome.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
});

it("falha do servidor aparece no aviso do topo e nada se perde", async () => {
  const api = renderPage([makeBill()]);
  await openCreate();
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Valor mínimo"), "10");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar conta a pagar" }));

  expect(await inDialog().findByRole("alert")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveValue("X");
});

it("a moeda sem centavos recusa valor com centavos", async () => {
  renderPage([makeBill()]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "Iene");
  await waitFor(() => expect(within(inDialog().getByLabelText("Moeda")).getAllByRole("option").length).toBeGreaterThan(1));
  await userEvent.selectOptions(inDialog().getByLabelText("Moeda"), "JPY - Iene japones");
  await userEvent.type(inDialog().getByLabelText("Valor mínimo"), "100,5");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar conta a pagar" }));

  expect(inDialog().getByText("Esta moeda não tem centavos.")).toBeInTheDocument();
});

it("cancelar fecha sem criar", async () => {
  const api = renderPage([makeBill()]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.click(inDialog().getByRole("button", { name: "Cancelar" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

// ---------- Editar ----------

const openEdit = async (name: string) => {
  await openMenu(name);
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  return await screen.findByRole("dialog", { name: "Editar conta a pagar" });
};

it("editar reabre os campos, com a moeda travada", async () => {
  renderPage([makeBill({ name: "Netflix", amount_min: "40.00", amount_max: "60.00", frequency: "quarterly" })]);
  await screen.findByText("Netflix");
  await openEdit("Netflix");

  expect(inDialog().getByLabelText("Nome")).toHaveValue("Netflix");
  expect(inDialog().getByLabelText("Valor mínimo")).toHaveValue("40,00");
  expect(inDialog().getByLabelText("Valor máximo")).toHaveValue("60,00");
  expect(inDialog().getByLabelText("Texto para ligar sozinho")).toHaveValue("netflix");
  expect(inDialog().getByLabelText("Frequência")).toHaveValue("quarterly");
  expect(inDialog().getByLabelText("Primeiro vencimento")).toHaveValue("2026-03-05");
  expect(inDialog().getByLabelText("Moeda")).toBeDisabled();
});

it("editar uma conta de preco fixo deixa o maximo em branco", async () => {
  renderPage([makeBill({ name: "Aluguel", amount_min: "1500.00", amount_max: "1500.00" })]);
  await screen.findByText("Aluguel");
  await openEdit("Aluguel");
  expect(inDialog().getByLabelText("Valor máximo")).toHaveValue("");
});

it("salvar sem mudar nada nao chama a API, inclusive no preco fixo", async () => {
  const api = renderPage([
    makeBill({ name: "Netflix" }),
    makeBill({ name: "Aluguel", amount_min: "1500.00", amount_max: "1500.00" }),
  ]);
  await screen.findByText("Netflix");
  await openEdit("Netflix");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

  await openEdit("Aluguel");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(0);
});

it("editar manda so o que mudou", async () => {
  const api = renderPage([makeBill({ name: "Netflix" })]);
  await screen.findByText("Netflix");
  await openEdit("Netflix");
  const max = inDialog().getByLabelText("Valor máximo");
  await userEvent.clear(max);
  await userEvent.type(max, "70");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ amount_max: "70.00" });
});

it("apagar o texto de ligacao manda null", async () => {
  const api = renderPage([makeBill({ name: "Netflix" })]);
  await screen.findByText("Netflix");
  await openEdit("Netflix");
  await userEvent.clear(inDialog().getByLabelText("Texto para ligar sozinho"));
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ match_text: null });
});

// ---------- Excluir ----------

it("excluir pede confirmacao e remove da lista", async () => {
  const api = renderPage([makeBill({ name: "Netflix" }), makeBill({ name: "Spotify" })]);
  await screen.findByText("Netflix");
  await openMenu("Netflix");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));

  const confirm = await screen.findByRole("dialog", { name: "Excluir conta a pagar" });
  expect(confirm).toHaveTextContent("Netflix");
  expect(confirm).toHaveTextContent("deixam de estar ligados");
  expect(api.mutations()).toHaveLength(0);
  await userEvent.click(within(confirm).getByRole("button", { name: "Excluir" }));

  await waitFor(() => expect(screen.queryByText("Netflix")).not.toBeInTheDocument());
  expect(api.mutations()[0].method).toBe("DELETE");
  expect(screen.getByText("Spotify")).toBeInTheDocument();
});

it("cancelar a exclusao nao apaga nada", async () => {
  const api = renderPage();
  await screen.findByText("Netflix");
  await openMenu("Netflix");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));

  expect(api.mutations()).toHaveLength(0);
  expect(screen.getByText("Netflix")).toBeInTheDocument();
});

it("a data de referencia e o dia do servidor, nao o do aparelho (aparelho com o relogio atrasado)", async () => {
  vi.setSystemTime(new Date("2026-03-10T15:00:00Z"));
  syncAppClock({ now: "2026-03-20T15:00:00Z", timezone: "America/Sao_Paulo" });
  const api = renderPage();
  await screen.findByText("Netflix");
  expect(api.statusRequests().at(-1)?.query?.get("on")).toBe("2026-03-20");
});
