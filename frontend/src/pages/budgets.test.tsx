import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { firstOfMonth, shiftMonth, appToday } from "@/lib/dates";
import { syncAppClock } from "@/lib/app-clock";
import { fakeAccountsApi } from "@/test-utils/accounts-api";
import { fakeBudgetsApi, makeBudget } from "@/test-utils/budgets-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import BudgetsPage from "./budgets";

// Data fixa (meio do mes): o teste nao pode depender de hoje ser dia 1 ou fim de mes
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 15, 12));
});
afterEach(() => vi.useRealTimers());

function renderPage(budgets = [makeBudget({ name: "Mercado", spent: "350.50" })]) {
  const api = fakeBudgetsApi(budgets);
  server.use(...api.handlers, ...fakeAccountsApi([]).handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <BudgetsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("li") as HTMLElement;
const openMenu = async (name: string) => {
  await userEvent.click(screen.getByRole("button", { name: `Ações do orçamento ${name}` }));
};
const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());

// ---------- Lista ----------

it("mostra nome, periodo, faixa de datas, gasto e quanto resta", async () => {
  renderPage();
  const item = card(await screen.findByRole("heading", { level: 3, name: "Mercado" }).then(() => "Mercado"));
  expect(within(item).getByText("Mensal · 01/03 a 31/03")).toBeInTheDocument();
  expect(within(item).getByText("R$ 350,50")).toBeInTheDocument();
  expect(within(item).getByText(/de R\$ 800,00/)).toBeInTheDocument();
  expect(within(item).getByText("Restam R$ 449,50")).toBeInTheDocument();
});

it("a barra de progresso informa o percentual a leitores de tela", async () => {
  renderPage();
  await screen.findByText("Mercado");
  const bar = screen.getByRole("progressbar", { name: "Gasto de Mercado" });
  expect(bar).toHaveAttribute("aria-valuenow", "43");
  expect(bar).toHaveAttribute("aria-valuetext", "43% do limite");
  expect(bar.firstElementChild).toHaveStyle({ width: "43%" });
});

it("abaixo de 80% nao ha aviso", async () => {
  renderPage([makeBudget({ name: "Folga", spent: "100.00" })]);
  await screen.findByText("Folga");
  expect(screen.queryByText(/Perto do limite/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Limite atingido/)).not.toBeInTheDocument();
});

it("de 80% a 99% avisa que esta perto do limite", async () => {
  renderPage([makeBudget({ name: "Quase", spent: "640.00" })]);
  await screen.findByText("Quase");
  expect(within(card("Quase")).getByText(/Perto do limite/)).toBeInTheDocument();
  expect(within(card("Quase")).getByText("Restam R$ 160,00")).toBeInTheDocument();
});

it("exatamente 80% ja e perto do limite, e 79% ainda nao", async () => {
  renderPage([makeBudget({ name: "Oitenta", spent: "640.00" }), makeBudget({ name: "Setenta", spent: "632.00" })]);
  await screen.findByText("Oitenta");
  expect(within(card("Oitenta")).getByText(/Perto do limite/)).toBeInTheDocument();
  expect(within(card("Setenta")).queryByText(/Perto do limite/)).not.toBeInTheDocument();
});

it("gasto exatamente igual ao limite ja e limite atingido, sem restar nada", async () => {
  renderPage([makeBudget({ name: "Justo", spent: "800.00" })]);
  await screen.findByText("Justo");
  expect(within(card("Justo")).getByText(/Limite atingido/)).toBeInTheDocument();
  expect(within(card("Justo")).getByText("Restam R$ 0,00")).toBeInTheDocument();
  expect(within(card("Justo")).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
});

it("ao passar do limite a barra fica cheia e o texto diz quanto passou", async () => {
  renderPage([makeBudget({ name: "Estourou", spent: "830.00" })]);
  await screen.findByText("Estourou");
  const item = card("Estourou");
  expect(within(item).getByText(/Limite atingido/)).toBeInTheDocument();
  expect(within(item).getByText("Passou R$ 30,00 do limite")).toBeInTheDocument();
  const bar = within(item).getByRole("progressbar");
  expect(bar).toHaveAttribute("aria-valuenow", "100");
  expect(bar.firstElementChild).toHaveStyle({ width: "100%" });
  expect(bar).toHaveAttribute("aria-valuetext", "103% do limite");
});

it("moeda estrangeira aparece no periodo e no valor", async () => {
  renderPage([makeBudget({ name: "Dolar", currency_code: "USD", amount: "100.00", spent: "10.00" })]);
  await screen.findByText("Dolar");
  expect(within(card("Dolar")).getByText(/Mensal · 01\/03 a 31\/03 · USD/)).toBeInTheDocument();
  expect(within(card("Dolar")).getByText("US$ 10,00")).toBeInTheDocument();
});

it("lista em ordem alfabetica", async () => {
  renderPage([makeBudget({ name: "Viagem" }), makeBudget({ name: "Casa" }), makeBudget({ name: "lazer" })]);
  await screen.findByText("Casa");
  const names = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  expect(names).toEqual(["Casa", "lazer", "Viagem"]);
});

it("sem orcamentos mostra o estado vazio com a acao de criar", async () => {
  renderPage([]);
  expect(await screen.findByText("Nenhum orçamento ainda")).toBeInTheDocument();
  const empty = screen.getByText("Nenhum orçamento ainda").closest("div") as HTMLElement;
  await userEvent.click(within(empty).getByRole("button", { name: /Novo orçamento/ }));
  expect(await screen.findByRole("dialog", { name: "Novo orçamento" })).toBeInTheDocument();
});

it("falha ao carregar mostra o erro e permite tentar de novo", async () => {
  const api = renderPage();
  await screen.findByText("Mercado");
  // Com a lista ja carregada, o proximo carregamento (outro mes) falha
  api.state.listError = true;
  await userEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();

  api.state.listError = false;
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByText("Mercado")).toBeInTheDocument();
});

// ---------- Periodos ----------

it("pede o progresso de hoje e permite voltar e avancar de mes", async () => {
  const api = renderPage();
  await screen.findByText("Mercado");
  const today = appToday();
  expect(today).toBe("2026-03-15");
  expect(api.progressRequests().at(-1)?.query?.get("on")).toBe(today);

  await userEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
  const previous = shiftMonth(today, -1);
  await waitFor(() => expect(api.progressRequests().at(-1)?.query?.get("on")).toBe(previous));
  expect(screen.getByRole("button", { name: "Mês atual" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
  await waitFor(() => expect(api.progressRequests().at(-1)?.query?.get("on")).toBe(today));
  expect(screen.queryByRole("button", { name: "Mês atual" })).not.toBeInTheDocument();
});

it("o botao Mes atual volta para hoje depois de navegar", async () => {
  const api = renderPage();
  await screen.findByText("Mercado");
  await userEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
  await userEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
  await userEvent.click(screen.getByRole("button", { name: "Mês atual" }));

  await waitFor(() => expect(api.progressRequests().at(-1)?.query?.get("on")).toBe(appToday()));
  expect(firstOfMonth(appToday())).toBeTruthy();
});

// ---------- Arquivados ----------

it("arquivados ficam escondidos ate pedir para mostrar", async () => {
  const api = renderPage([makeBudget({ name: "Ativo" }), makeBudget({ name: "Velho", active: false })]);
  await screen.findByText("Ativo");
  expect(screen.queryByText("Velho")).not.toBeInTheDocument();
  expect(api.progressRequests().at(-1)?.query?.get("include_archived")).toBe("false");

  await userEvent.click(screen.getByLabelText("Mostrar arquivados"));
  expect(await screen.findByText("Velho")).toBeInTheDocument();
  expect(within(card("Velho")).getByText("Arquivado")).toBeInTheDocument();
  expect(api.progressRequests().at(-1)?.query?.get("include_archived")).toBe("true");
});

it("arquivar manda active falso e o orcamento some da lista", async () => {
  const api = renderPage([makeBudget({ name: "Mercado" })]);
  await screen.findByText("Mercado");
  await openMenu("Mercado");
  await userEvent.click(screen.getByRole("menuitem", { name: "Arquivar" }));

  await waitFor(() => expect(screen.queryByText("Mercado")).not.toBeInTheDocument());
  expect(api.mutations()[0]).toMatchObject({ method: "PATCH", body: { active: false } });
});

it("restaurar um arquivado manda active verdadeiro", async () => {
  const api = renderPage([makeBudget({ name: "Velho", active: false })]);
  await userEvent.click(await screen.findByLabelText("Mostrar arquivados"));
  await screen.findByText("Velho");
  await openMenu("Velho");
  await userEvent.click(screen.getByRole("menuitem", { name: "Restaurar" }));

  await waitFor(() => expect(within(card("Velho")).queryByText("Arquivado")).not.toBeInTheDocument());
  expect(api.mutations()[0]).toMatchObject({ body: { active: true } });
});

it("falha ao arquivar mostra o erro", async () => {
  const api = renderPage();
  await screen.findByText("Mercado");
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await openMenu("Mercado");
  await userEvent.click(screen.getByRole("menuitem", { name: "Arquivar" }));

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("Mercado")).toBeInTheDocument();
});

// ---------- Criar ----------

const openCreate = async () => {
  await userEvent.click(await screen.findByRole("button", { name: /Novo orçamento/ }));
  return await screen.findByRole("dialog", { name: "Novo orçamento" });
};

it("cria um orcamento mensal com o valor no formato brasileiro", async () => {
  const api = renderPage([]);
  await screen.findByText("Nenhum orçamento ainda");
  await userEvent.click(screen.getAllByRole("button", { name: /Novo orçamento/ })[0]);
  await screen.findByRole("dialog");

  await userEvent.type(inDialog().getByLabelText("Nome"), "  Mercado ");
  await userEvent.type(inDialog().getByLabelText("Limite por período"), "1.234,50");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar orçamento" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()[0].body).toEqual({
    name: "Mercado",
    currency_code: "BRL",
    mode: "fixed",
    amount: "1234.50",
    period: "monthly",
  });
  expect(await screen.findByRole("heading", { level: 3, name: "Mercado" })).toBeInTheDocument();
});

it("o periodo escolhido vai no corpo", async () => {
  const api = renderPage([makeBudget({ name: "Outro" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "Semana");
  await userEvent.type(inDialog().getByLabelText("Limite por período"), "100");
  await userEvent.selectOptions(inDialog().getByLabelText("Período"), "Semanal");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar orçamento" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ period: "weekly" });
});

it("campos vazios mostram os erros, focam o primeiro e nao chamam a API", async () => {
  const api = renderPage([makeBudget()]);
  await openCreate();
  await userEvent.click(inDialog().getByRole("button", { name: "Criar orçamento" }));

  expect(inDialog().getByText("Informe o nome do orçamento.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe o valor do limite.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it.each([
  ["0", "Informe um valor maior que zero."],
  ["0,00", "Informe um valor maior que zero."],
  ["-5", "Informe um valor maior que zero."],
  ["abc", "Valor inválido."],
  ["10,555", "Use no máximo 2 casas decimais."],
])("limite %j mostra %j", async (value, message) => {
  const api = renderPage([makeBudget()]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Limite por período"), value);
  await userEvent.click(inDialog().getByRole("button", { name: "Criar orçamento" }));

  expect(inDialog().getByText(message)).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("o erro some quando o campo e corrigido", async () => {
  renderPage([makeBudget()]);
  await openCreate();
  await userEvent.click(inDialog().getByRole("button", { name: "Criar orçamento" }));
  expect(inDialog().getByText("Informe o nome do orçamento.")).toBeInTheDocument();
  await userEvent.type(inDialog().getByLabelText("Nome"), "a");
  expect(inDialog().queryByText("Informe o nome do orçamento.")).not.toBeInTheDocument();
});

it("nome repetido aparece no campo do nome e o dialogo continua aberto", async () => {
  renderPage([makeBudget({ name: "Mercado" })]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "mercado");
  await userEvent.type(inDialog().getByLabelText("Limite por período"), "100");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar orçamento" }));

  expect(await inDialog().findByText("Já existe um orçamento com esse nome.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
});

it("falha do servidor aparece no aviso do topo do dialogo", async () => {
  const api = renderPage([makeBudget()]);
  await openCreate();
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await userEvent.type(inDialog().getByLabelText("Nome"), "X");
  await userEvent.type(inDialog().getByLabelText("Limite por período"), "100");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar orçamento" }));

  expect(await inDialog().findByRole("alert")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveValue("X");
});

it("a moeda sem centavos recusa valor com centavos", async () => {
  renderPage([makeBudget()]);
  await openCreate();
  await userEvent.type(inDialog().getByLabelText("Nome"), "Iene");
  await waitFor(() => expect(within(inDialog().getByLabelText("Moeda")).getAllByRole("option").length).toBeGreaterThan(1));
  await userEvent.selectOptions(inDialog().getByLabelText("Moeda"), "JPY - Iene japones");
  await userEvent.type(inDialog().getByLabelText("Limite por período"), "100,5");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar orçamento" }));

  expect(inDialog().getByText("Esta moeda não tem centavos.")).toBeInTheDocument();
});

it("cancelar fecha sem criar", async () => {
  const api = renderPage([makeBudget()]);
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
  return await screen.findByRole("dialog", { name: "Editar orçamento" });
};

it("editar reabre os campos, com a moeda travada", async () => {
  renderPage([makeBudget({ name: "Mercado", amount: "1234.50", period: "weekly" })]);
  await screen.findByText("Mercado");
  await openEdit("Mercado");

  expect(inDialog().getByLabelText("Nome")).toHaveValue("Mercado");
  expect(inDialog().getByLabelText("Limite por período")).toHaveValue("1234,50");
  expect(inDialog().getByLabelText("Período")).toHaveValue("weekly");
  expect(inDialog().getByLabelText("Moeda")).toBeDisabled();
});

it("editar manda so o que mudou", async () => {
  const api = renderPage([makeBudget({ name: "Mercado", amount: "800.00" })]);
  await screen.findByText("Mercado");
  await openEdit("Mercado");

  const amount = inDialog().getByLabelText("Limite por período");
  await userEvent.clear(amount);
  await userEvent.type(amount, "900");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(1);
  expect(api.mutations()[0].body).toEqual({ amount: "900.00" });
  expect(await screen.findByText(/de R\$ 900,00/)).toBeInTheDocument();
});

it("salvar sem mudar nada nao chama a API", async () => {
  const api = renderPage([makeBudget({ name: "Mercado" })]);
  await screen.findByText("Mercado");
  await openEdit("Mercado");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(0);
});

it("editar o nome e o periodo", async () => {
  const api = renderPage([makeBudget({ name: "Mercado" })]);
  await screen.findByText("Mercado");
  await openEdit("Mercado");
  const name = inDialog().getByLabelText("Nome");
  await userEvent.clear(name);
  await userEvent.type(name, "Supermercado");
  await userEvent.selectOptions(inDialog().getByLabelText("Período"), "Anual");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ name: "Supermercado", period: "yearly" });
});

// ---------- Excluir ----------

it("excluir pede confirmacao e remove da lista", async () => {
  const api = renderPage([makeBudget({ name: "Mercado" }), makeBudget({ name: "Lazer" })]);
  await screen.findByText("Mercado");
  await openMenu("Mercado");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));

  const confirm = await screen.findByRole("dialog", { name: "Excluir orçamento" });
  expect(confirm).toHaveTextContent("Mercado");
  expect(confirm).toHaveTextContent("ficam sem orçamento");
  expect(api.mutations()).toHaveLength(0);
  await userEvent.click(within(confirm).getByRole("button", { name: "Excluir" }));

  await waitFor(() => expect(screen.queryByText("Mercado")).not.toBeInTheDocument());
  expect(api.mutations()[0].method).toBe("DELETE");
  expect(screen.getByText("Lazer")).toBeInTheDocument();
});

it("cancelar a exclusao nao apaga nada", async () => {
  const api = renderPage();
  await screen.findByText("Mercado");
  await openMenu("Mercado");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));

  expect(api.mutations()).toHaveLength(0);
  expect(screen.getByText("Mercado")).toBeInTheDocument();
});

it("o periodo e o mes do servidor, nao o do aparelho (aparelho com o relogio atrasado)", async () => {
  // O aparelho acha que e 29/03; o servidor sabe que e 01/04 (e ja e outro mes)
  vi.setSystemTime(new Date("2026-03-29T15:00:00Z"));
  syncAppClock({ now: "2026-04-01T15:00:00Z", timezone: "America/Sao_Paulo" });
  const api = renderPage();
  await screen.findByText("Mercado");
  expect(api.progressRequests().at(-1)?.query?.get("on")).toBe("2026-04-01");
  expect(screen.getByText("Abril de 2026")).toBeInTheDocument();
});
