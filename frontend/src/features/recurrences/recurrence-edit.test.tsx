import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeLabelsApi } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeRecurrencesApi, makeRecurrence, makeTemplateSplit } from "@/test-utils/recurrences-api";
import { RecurrenceManageDialog } from "./recurrence-manage-dialog";

// A edicao da recorrencia (o formulario em modo recorrencia) a partir do dialogo de gestao da tela de Transacoes.
const nubank = makeAccount({ id: "a0000000-0000-4000-8000-000000000001", name: "Nubank" });
const poupanca = makeAccount({ id: "a0000000-0000-4000-8000-000000000002", name: "Poupanca" });

// Data fixa: "em N dias" e a primeira data padrao dependem de hoje
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 15, 12));
});
afterEach(() => vi.useRealTimers());

function renderManage(recurrence = makeRecurrence({ name: "Aluguel" })) {
  const api = fakeRecurrencesApi([recurrence]);
  const onClose = vi.fn();
  server.use(
    ...api.handlers,
    ...fakeAccountsApi([nubank, poupanca]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
    ...fakeBudgetsApi([]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <RecurrenceManageDialog recurrenceId={recurrence.id} onClose={onClose} />
      </MemoryRouter>
    </FakeAuth>,
  );
  return { api, onClose };
}

const inDialog = () => within(screen.getByRole("dialog"));

const openEdit = async (name: string) => {
  await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
  const form = await screen.findByRole("dialog", { name: "Editar recorrente" });
  await waitFor(() => expect(within(form).getByLabelText("Conta")).toHaveValue(nubank.id));
  expect(within(form).getByLabelText("Nome da recorrente")).toHaveValue(name);
};

it("editar reabre nome, frequencia, primeira data e o modelo, com frequencia e data travadas", async () => {
  renderManage(makeRecurrence({ name: "Aluguel", frequency: "quarterly", first_date: "2026-03-05" }));
  await openEdit("Aluguel");

  expect(inDialog().getByLabelText("Frequência")).toHaveValue("quarterly");
  expect(inDialog().getByLabelText("Frequência")).toBeDisabled();
  expect(inDialog().getByLabelText("Primeira data")).toHaveValue("2026-03-05");
  expect(inDialog().getByLabelText("Primeira data")).toBeDisabled();
  expect(inDialog().getByLabelText("Descrição")).toHaveValue("Aluguel");
  expect(inDialog().getByLabelText("Para quem")).toHaveValue("Imobiliaria");
  expect(inDialog().getByLabelText(/^Valor \(BRL\)/)).toHaveValue("1.500,00");
  expect(inDialog().getByLabelText("Termina")).toHaveValue("never");
});

it("editar reabre o fim por quantidade", async () => {
  renderManage(makeRecurrence({ name: "Por vezes", max_occurrences: 12 }));
  await openEdit("Por vezes");
  expect(inDialog().getByLabelText("Termina")).toHaveValue("count");
  expect(inDialog().getByLabelText("Quantas vezes")).toHaveValue("12");
});

it("editar reabre o fim por data", async () => {
  renderManage(makeRecurrence({ name: "Por data", end_date: "2026-12-31" }));
  await openEdit("Por data");
  expect(inDialog().getByLabelText("Termina")).toHaveValue("date");
  expect(inDialog().getByLabelText("Data final")).toHaveValue("2026-12-31");
});

it("editar manda nome, modelo e o fim, sem frequencia nem primeira data", async () => {
  const { api, onClose } = renderManage();
  await openEdit("Aluguel");

  const amount = inDialog().getByLabelText(/^Valor \(BRL\)/);
  await userEvent.clear(amount);
  await userEvent.type(amount, "180000");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  const body = api.mutations()[0].body as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["end_date", "max_occurrences", "name", "template"]);
  expect(body).toMatchObject({ name: "Aluguel", end_date: null, max_occurrences: null });
  expect((body.template as { splits: { amount: string }[] }).splits[0].amount).toBe("1800.00");
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("salvar sem mexer em nada mantem o modelo igual (inclusive sem bill_id)", async () => {
  const { api } = renderManage();
  await openEdit("Aluguel");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  const split = (api.mutations()[0].body as { template: { splits: Record<string, unknown>[] } }).template.splits[0];
  expect(split).not.toHaveProperty("bill_id");
  expect(split).toMatchObject({ description: "Aluguel", amount: "1500.00", counterparty_name: "Imobiliaria" });
});

it("trocar o fim na edicao manda o novo fim", async () => {
  const { api } = renderManage(makeRecurrence({ name: "Aluguel", max_occurrences: 12 }));
  await openEdit("Aluguel");
  await userEvent.selectOptions(inDialog().getByLabelText("Termina"), "Nunca");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ end_date: null, max_occurrences: null });
});

it("modelo que o formulario nao representa mostra o aviso e nao deixa salvar", async () => {
  renderManage(
    makeRecurrence({
      name: "Estranha",
      template: { splits: [makeTemplateSplit(), makeTemplateSplit({ account_id: poupanca.id })] },
    }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
  const form = await screen.findByRole("dialog", { name: "Editar recorrente" });

  expect(await within(form).findByText(/só pode ser editado pela API/)).toBeInTheDocument();
  expect(within(form).queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
});

it("o resumo concorda o numero de criadas e de vezes: uma vez e varias", async () => {
  renderManage(makeRecurrence({ name: "Uma", max_occurrences: 1, created_count: 1 }));
  expect(await screen.findByText("1 vez (1 criada)")).toBeInTheDocument();
});

it("o resumo de uma recorrente sem data final conta as criadas", async () => {
  renderManage(makeRecurrence({ name: "Duas", created_count: 2 }));
  expect(await screen.findByText(/Sem data final · 2 criadas/)).toBeInTheDocument();
});
