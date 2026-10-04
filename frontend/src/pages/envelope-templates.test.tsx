import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { PreviewRow, Template } from "@/api/envelopes";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBillsApi, makeBill } from "@/test-utils/bills-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeEnvelopesApi, makeEnvelope } from "@/test-utils/envelopes-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import EnvelopesPage from "./envelopes";

// Data fixa: o mes mostrado ao abrir depende de hoje
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 15, 12));
});
afterEach(() => vi.useRealTimers());

const rent = makeBill({ name: "Aluguel", amount_max: "1900.00" });
const dollars = makeBill({ name: "Assinatura em dolar", currency_code: "USD", amount_max: "10.00" });

function renderPage(envelopes = [makeEnvelope("Mercado", { allocated: 100 }), makeEnvelope("Reserva")]) {
  const api = fakeEnvelopesApi(envelopes);
  server.use(
    ...api.handlers,
    ...fakeAccountsApi([makeAccount()]).handlers,
    ...fakeBudgetsApi().handlers,
    ...fakeBillsApi([rent, dollars]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <EnvelopesPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const user = userEvent.setup();
const money = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const row = (name: string) => screen.getByRole("rowheader", { name: new RegExp(`^${name}`) }).closest("tr") as HTMLElement;
const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());

async function openTemplate(name: string) {
  await screen.findByRole("rowheader", { name: new RegExp(`^${name}`) });
  await user.click(screen.getByRole("button", { name: `Ações do envelope ${name}` }));
}

const choose = (label: string) => user.click(inDialog().getByRole("radio", { name: new RegExp(label) }));
const save = () => user.click(inDialog().getByRole("button", { name: "Salvar" }));

const previewRow = (overrides: Partial<PreviewRow>): PreviewRow => ({
  budget_id: "x",
  name: "Mercado",
  kind: "fixed",
  current: "0.00",
  wanted: "300.00",
  proposed: "300.00",
  applies: true,
  reason: null,
  ...overrides,
});

// ---------- Resumo e selo na linha ----------

it("cada tipo de template aparece resumido embaixo do nome do envelope", async () => {
  const envelopes = [makeEnvelope("Fixo"), makeEnvelope("Meta"), makeEnvelope("Casa"), makeEnvelope("Resto"), makeEnvelope("Livre")];
  const api = renderPage(envelopes);
  const [fixed, goal, bill, rest] = envelopes;
  api.state.templates.set(fixed.budget_id, { kind: "fixed", amount: "300.00", target_month: null, bill_id: null });
  api.state.templates.set(goal.budget_id, { kind: "by_date", amount: "6000.00", target_month: "2026-06-01", bill_id: null });
  api.state.templates.set(bill.budget_id, { kind: "bill", amount: null, target_month: null, bill_id: rent.id });
  api.state.templates.set(rest.budget_id, { kind: "remainder", amount: null, target_month: null, bill_id: null });
  await user.click(await screen.findByRole("button", { name: "Mês anterior" }));
  await user.click(screen.getByRole("button", { name: "Próximo mês" }));
  await screen.findByText("Conta: Aluguel");
  expect(money(within(row("Fixo")).getByText(/por mês/).textContent)).toBe("R$ 300,00 por mês");
  expect(money(within(row("Meta")).getByText(/até/).textContent)).toBe("R$ 6.000,00 até junho de 2026");
  expect(within(row("Resto")).getByText("O que sobrar")).toBeInTheDocument();
  expect(within(row("Livre")).queryByText(/por mês|Conta:|O que sobrar/)).not.toBeInTheDocument();
});

it("o selo de meta aparece com texto e so quando ha template", async () => {
  const envelopes = [makeEnvelope("Bateu"), makeEnvelope("Metade"), makeEnvelope("Longe"), makeEnvelope("Sem")];
  const api = renderPage(envelopes);
  const template: Template = { kind: "fixed", amount: "300.00", target_month: null, bill_id: null };
  api.state.templates.set(envelopes[0].budget_id, template);
  api.state.templates.set(envelopes[1].budget_id, template);
  api.state.templates.set(envelopes[2].budget_id, template);
  api.state.goals.set(envelopes[0].budget_id, "met");
  api.state.goals.set(envelopes[1].budget_id, "partial");
  api.state.goals.set(envelopes[2].budget_id, "short");
  await user.click(await screen.findByRole("button", { name: "Próximo mês" }));
  await user.click(screen.getByRole("button", { name: "Mês anterior" }));
  await screen.findByText("Meta batida");
  expect(within(row("Bateu")).getByText("Meta batida")).toBeInTheDocument();
  expect(within(row("Metade")).getByText("Falta pouco")).toBeInTheDocument();
  expect(within(row("Longe")).getByText("Longe da meta")).toBeInTheDocument();
  expect(within(row("Sem")).queryByText(/meta/i)).not.toBeInTheDocument();
});

it("o menu oferece Definir template e, com template, Mudar template", async () => {
  const envelopes = [makeEnvelope("Novo"), makeEnvelope("Tem")];
  const api = renderPage(envelopes);
  api.state.templates.set(envelopes[1].budget_id, { kind: "remainder", amount: null, target_month: null, bill_id: null });
  await user.click(await screen.findByRole("button", { name: "Próximo mês" }));
  await user.click(screen.getByRole("button", { name: "Mês anterior" }));
  await screen.findByText("O que sobrar");
  await user.click(screen.getByRole("button", { name: "Ações do envelope Novo" }));
  expect(screen.getByRole("menuitem", { name: "Definir template" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Ações do envelope Tem" }));
  expect(screen.getByRole("menuitem", { name: "Mudar template" })).toBeInTheDocument();
});

// ---------- Definir o template ----------

it("o formulario abre em valor fixo e mostra so os campos do tipo", async () => {
  renderPage();
  await openTemplate("Mercado");
  await user.click(screen.getByRole("menuitem", { name: "Definir template" }));
  expect(inDialog().getByRole("heading", { name: "Template de Mercado" })).toBeInTheDocument();
  expect(inDialog().getByRole("radio", { name: /Valor fixo por mês/ })).toBeChecked();
  expect(inDialog().getByLabelText("Valor por mês (BRL)")).toBeInTheDocument();
  expect(inDialog().queryByLabelText(/Meta pronta/)).not.toBeInTheDocument();
  expect(inDialog().queryByLabelText("Conta a pagar")).not.toBeInTheDocument();
  expect(inDialog().queryByRole("button", { name: "Tirar template" })).not.toBeInTheDocument();

  await choose("Juntar até uma data");
  expect(inDialog().getByLabelText("Meta (BRL)")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Meta pronta até o mês")).toBeInTheDocument();
  await choose("Ligado a uma conta");
  expect(inDialog().queryByLabelText("Meta (BRL)")).not.toBeInTheDocument();
  expect(inDialog().getByLabelText("Conta a pagar")).toBeInTheDocument();
  await choose("O que sobrar");
  expect(inDialog().queryByLabelText("Conta a pagar")).not.toBeInTheDocument();
  expect(inDialog().queryByLabelText("Valor por mês (BRL)")).not.toBeInTheDocument();
  expect(inDialog().queryByLabelText("Meta (BRL)")).not.toBeInTheDocument();
});

async function openDefine(name = "Mercado") {
  await openTemplate(name);
  await user.click(screen.getByRole("menuitem", { name: /template/ }));
}

it("valor fixo: manda so kind e valor", async () => {
  const api = renderPage();
  await openDefine();
  await user.type(inDialog().getByLabelText("Valor por mês (BRL)"), "300,00");
  await save();
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0]).toMatchObject({ method: "PUT", body: { kind: "fixed", amount: "300.00" } });
  expect(Object.keys(api.mutations()[0].body ?? {}).sort()).toEqual(["amount", "kind"]);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("valor fixo vazio, zero ou invalido mostra o aviso e nao chama a API", async () => {
  const api = renderPage();
  await openDefine();
  await save();
  expect(inDialog().getByText("Informe o valor.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Valor por mês (BRL)")).toHaveFocus();
  await user.type(inDialog().getByLabelText("Valor por mês (BRL)"), "0");
  await save();
  expect(inDialog().getByText("Informe um valor maior que zero.")).toBeInTheDocument();
  await user.clear(inDialog().getByLabelText("Valor por mês (BRL)"));
  await user.type(inDialog().getByLabelText("Valor por mês (BRL)"), "abc");
  await save();
  expect(inDialog().getByText("Valor inválido.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("meta por data: manda valor e mes, e pede o mes", async () => {
  const api = renderPage();
  await openDefine();
  await choose("Juntar até uma data");
  await user.type(inDialog().getByLabelText("Meta (BRL)"), "6000");
  await save();
  expect(inDialog().getByText("Escolha o mês em que a meta precisa estar pronta.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
  await user.type(inDialog().getByLabelText("Meta pronta até o mês"), "2026-06");
  await save();
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ kind: "by_date", amount: "6000.00", target_month: "2026-06" });
});

it("conta a pagar: so lista contas na moeda do envelope e pede a escolha", async () => {
  const api = renderPage();
  await openDefine();
  await choose("Ligado a uma conta");
  const select = inDialog().getByLabelText("Conta a pagar");
  const options = within(select).getAllByRole("option").map((option) => money(option.textContent));
  expect(options).toEqual(["Escolha a conta", "Aluguel (até R$ 1.900,00)"]);
  await save();
  expect(inDialog().getByText("Escolha a conta a pagar.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
  await user.selectOptions(select, rent.id);
  await save();
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ kind: "bill", bill_id: rent.id });
});

it("o que sobrar manda so o tipo", async () => {
  const api = renderPage();
  await openDefine();
  await choose("O que sobrar");
  await save();
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ kind: "remainder" });
});

it("trocar de tipo limpa os avisos", async () => {
  renderPage();
  await openDefine();
  await save();
  expect(inDialog().getByText("Informe o valor.")).toBeInTheDocument();
  await choose("O que sobrar");
  await choose("Valor fixo por mês");
  expect(inDialog().queryByText("Informe o valor.")).not.toBeInTheDocument();
});

it("editar abre com o template atual e deixa tirar", async () => {
  const envelopes = [makeEnvelope("Mercado"), makeEnvelope("Outro")];
  const api = renderPage(envelopes);
  api.state.templates.set(envelopes[0].budget_id, { kind: "by_date", amount: "6000.00", target_month: "2026-06-01", bill_id: null });
  await user.click(await screen.findByRole("button", { name: "Próximo mês" }));
  await user.click(screen.getByRole("button", { name: "Mês anterior" }));
  await screen.findByText(/até junho/);
  await user.click(screen.getByRole("button", { name: "Ações do envelope Mercado" }));
  await user.click(screen.getByRole("menuitem", { name: "Mudar template" }));
  expect(inDialog().getByRole("radio", { name: /Juntar até uma data/ })).toBeChecked();
  expect(inDialog().getByLabelText("Meta (BRL)")).toHaveValue("6000,00");
  expect(inDialog().getByLabelText("Meta pronta até o mês")).toHaveValue("2026-06");

  await user.click(inDialog().getByRole("button", { name: "Tirar template" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].method).toBe("DELETE");
  await waitFor(() => expect(screen.queryByText(/até junho/)).not.toBeInTheDocument());
});

it("falha do servidor ao salvar aparece no topo da janela e nada se perde", async () => {
  const api = renderPage();
  await openDefine();
  await user.type(inDialog().getByLabelText("Valor por mês (BRL)"), "50");
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await save();
  expect(await inDialog().findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");
  expect(inDialog().getByLabelText("Valor por mês (BRL)")).toHaveValue("50");
});

it("valor com casas demais para a moeda aparece no campo", async () => {
  const api = renderPage();
  await openDefine();
  await user.type(inDialog().getByLabelText("Valor por mês (BRL)"), "50");
  api.state.nextMutationError = { status: 400, code: "invalid_amount" };
  await save();
  expect(await inDialog().findByText("Valor inválido para esta moeda.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Valor por mês (BRL)")).toHaveFocus();
});

it("cancelar fecha sem chamar a API", async () => {
  const api = renderPage();
  await openDefine();
  await user.click(inDialog().getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(0);
});

// ---------- Aplicar ----------

async function openApply() {
  await user.click(await screen.findByRole("button", { name: "Aplicar templates" }));
  return dialog();
}

it("o botao Aplicar templates so existe com envelopes", async () => {
  renderPage([]);
  await screen.findByText("Nenhum envelope ainda");
  expect(screen.queryByRole("button", { name: "Aplicar templates" })).not.toBeInTheDocument();
});

it("a previa mostra o que cada envelope faria, com texto para quem fica de fora", async () => {
  const envelopes = [makeEnvelope("Mercado"), makeEnvelope("Reserva", { allocated: 40 }), makeEnvelope("Seguro"), makeEnvelope("Meta")];
  const api = renderPage(envelopes);
  api.state.preview = {
    month: "2026-03-01",
    overwrite: false,
    groups: [
      {
        currency_code: "BRL",
        to_budget_before: "1000.00",
        to_budget_after: "700.00",
        rows: [
          previewRow({ budget_id: envelopes[0].budget_id, name: "Mercado" }),
          previewRow({ budget_id: envelopes[1].budget_id, name: "Reserva", kind: "remainder", current: "40.00", proposed: "40.00", applies: false, reason: "already_has" }),
          previewRow({ budget_id: envelopes[2].budget_id, name: "Seguro", kind: "bill", wanted: "0.00", proposed: "0.00", applies: false, reason: "no_due_date" }),
          previewRow({ budget_id: envelopes[3].budget_id, name: "Meta", kind: "by_date", wanted: "0.00", proposed: "0.00", applies: false, reason: "goal_met" }),
        ],
      },
    ],
  };
  await openApply();
  await inDialog().findByRole("table", { name: "Prévia em BRL" });
  expect(inDialog().getByRole("heading", { name: /Aplicar templates em março de 2026/ })).toBeInTheDocument();
  const table = within(inDialog().getByRole("table", { name: "Prévia em BRL" }));
  const market = table.getByRole("rowheader", { name: /Mercado/ }).closest("tr") as HTMLElement;
  expect(within(market).getByText("Vai mudar")).toBeInTheDocument();
  expect(money(within(market).getAllByRole("cell")[1].textContent)).toContain("R$ 300,00");
  expect(within(market).getByText("Valor fixo por mês")).toBeInTheDocument();
  expect(table.getByText("Já tem valor")).toBeInTheDocument();
  expect(table.getByText("A conta não vence neste mês")).toBeInTheDocument();
  expect(table.getByText("Meta já atingida")).toBeInTheDocument();
  expect(inDialog().getByRole("status", { name: "" })).toBeDefined();
  expect(inDialog().getByText("1 envelope vai mudar.")).toBeInTheDocument();
  const group = inDialog().getByRole("region", { name: "Prévia em BRL" });
  expect(money(group.textContent)).toContain("R$ 1.000,00 depois de aplicar fica R$ 700,00");
});

it("quando os templates somam mais do que se tem, avisa mas deixa aplicar", async () => {
  const envelopes = [makeEnvelope("Mercado")];
  const api = renderPage(envelopes);
  api.state.preview = {
    month: "2026-03-01",
    overwrite: false,
    groups: [{ currency_code: "BRL", to_budget_before: "1000.00", to_budget_after: "-500.00", rows: [previewRow({ budget_id: envelopes[0].budget_id, proposed: "1500.00" })] }],
  };
  await openApply();
  expect(await inDialog().findByRole("alert")).toHaveTextContent("Os templates somam mais do que você tem");
  expect(inDialog().getByRole("button", { name: "Aplicar" })).toBeEnabled();
});

it("sem aviso quando o A orcar fica positivo ou zerado", async () => {
  const envelopes = [makeEnvelope("Mercado")];
  const api = renderPage(envelopes);
  api.state.preview = {
    month: "2026-03-01",
    overwrite: false,
    groups: [{ currency_code: "BRL", to_budget_before: "1000.00", to_budget_after: "0.00", rows: [previewRow({ budget_id: envelopes[0].budget_id })] }],
  };
  await openApply();
  await inDialog().findByRole("table", { name: "Prévia em BRL" });
  expect(inDialog().queryByRole("alert")).not.toBeInTheDocument();
});

it("aplicar manda o mes e o modo, fecha a janela e atualiza a tabela", async () => {
  const envelopes = [makeEnvelope("Mercado")];
  const api = renderPage(envelopes);
  api.state.preview = {
    month: "2026-03-01",
    overwrite: false,
    groups: [{ currency_code: "BRL", to_budget_before: "1000.00", to_budget_after: "700.00", rows: [previewRow({ budget_id: envelopes[0].budget_id, proposed: "300.00" })] }],
  };
  await openApply();
  await inDialog().findByRole("table", { name: "Prévia em BRL" });
  await user.click(inDialog().getByRole("button", { name: "Aplicar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(1);
  expect(api.mutations()[0]).toMatchObject({ method: "POST", path: "/envelopes/templates/apply", body: { month: "2026-03", overwrite: false } });
  expect((screen.getByLabelText("Distribuído para Mercado") as HTMLInputElement).value).toBe("300,00");
});

it("marcar Sobrescrever pede a previa de novo com overwrite e aplica nesse modo", async () => {
  const envelopes = [makeEnvelope("Mercado", { allocated: 50 })];
  const api = renderPage(envelopes);
  api.state.preview = {
    month: "2026-03-01",
    overwrite: false,
    groups: [{ currency_code: "BRL", to_budget_before: "950.00", to_budget_after: "700.00", rows: [previewRow({ budget_id: envelopes[0].budget_id, current: "50.00", proposed: "300.00" })] }],
  };
  await openApply();
  await inDialog().findByRole("table", { name: "Prévia em BRL" });
  const before = api.state.requests.filter((request) => request.path === "/envelopes/templates/preview");
  expect(before.at(-1)?.body).toEqual({ overwrite: "false" });
  await user.click(inDialog().getByLabelText("Sobrescrever os envelopes que já têm valor"));
  await waitFor(() =>
    expect(api.state.requests.filter((request) => request.path === "/envelopes/templates/preview").at(-1)?.body).toEqual({ overwrite: "true" }),
  );
  await inDialog().findByRole("table", { name: "Prévia em BRL" });
  await user.click(inDialog().getByRole("button", { name: "Aplicar" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ month: "2026-03", overwrite: true });
});

it("sem nada para mudar o botao fica desabilitado e diz isso", async () => {
  const envelopes = [makeEnvelope("Mercado")];
  const api = renderPage(envelopes);
  api.state.preview = {
    month: "2026-03-01",
    overwrite: false,
    groups: [{ currency_code: "BRL", to_budget_before: "1000.00", to_budget_after: "1000.00", rows: [previewRow({ budget_id: envelopes[0].budget_id, applies: false, reason: "already_has", proposed: "0.00" })] }],
  };
  await openApply();
  await inDialog().findByRole("table", { name: "Prévia em BRL" });
  expect(inDialog().getByRole("button", { name: "Nada para aplicar" })).toBeDisabled();
  expect(inDialog().getByText("Nenhum envelope vai mudar.")).toBeInTheDocument();
});

it("sem nenhum template explica como definir", async () => {
  renderPage();
  await openApply();
  expect(await inDialog().findByText(/Nenhum envelope tem template ainda/)).toBeInTheDocument();
  expect(inDialog().getByRole("button", { name: "Nada para aplicar" })).toBeDisabled();
});

it("grupos sem nenhum template ficam fora da previa", async () => {
  const envelopes = [makeEnvelope("Mercado")];
  const api = renderPage(envelopes);
  api.state.preview = {
    month: "2026-03-01",
    overwrite: false,
    groups: [
      { currency_code: "BRL", to_budget_before: "1000.00", to_budget_after: "700.00", rows: [previewRow({ budget_id: envelopes[0].budget_id })] },
      { currency_code: "USD", to_budget_before: "200.00", to_budget_after: "200.00", rows: [] },
    ],
  };
  await openApply();
  await inDialog().findByRole("table", { name: "Prévia em BRL" });
  expect(inDialog().queryByRole("region", { name: "Prévia em USD" })).not.toBeInTheDocument();
});

it("falha ao calcular a previa permite tentar de novo", async () => {
  const api = renderPage();
  await screen.findByRole("rowheader", { name: /Mercado/ });
  api.state.viewError = true;
  await user.click(screen.getByRole("button", { name: "Aplicar templates" }));
  expect(await inDialog().findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");
  api.state.viewError = false;
  await user.click(inDialog().getByRole("button", { name: "Tentar de novo" }));
  expect(await inDialog().findByText(/Nenhum envelope tem template ainda/)).toBeInTheDocument();
});

it("falha ao aplicar mostra o erro e a janela continua aberta", async () => {
  const envelopes = [makeEnvelope("Mercado")];
  const api = renderPage(envelopes);
  api.state.preview = {
    month: "2026-03-01",
    overwrite: false,
    groups: [{ currency_code: "BRL", to_budget_before: "1000.00", to_budget_after: "700.00", rows: [previewRow({ budget_id: envelopes[0].budget_id })] }],
  };
  await openApply();
  await inDialog().findByRole("table", { name: "Prévia em BRL" });
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await user.click(inDialog().getByRole("button", { name: "Aplicar" }));
  expect(await inDialog().findByText("Algo deu errado do nosso lado. Tente novamente.")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("cancelar a previa fecha sem gravar nada", async () => {
  const api = renderPage();
  await openApply();
  await user.click(inDialog().getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(0);
});
