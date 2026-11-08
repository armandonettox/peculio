import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import type { Transaction } from "@/api/transactions";
import { appToday } from "@/lib/dates";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi, makeBudget } from "@/test-utils/budgets-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth, WithSidebar, openIncomeForm, pickChip } from "@/test-utils/providers";
import { fakeRecurrencesApi, makeReminder } from "@/test-utils/recurrences-api";
import { deposit } from "@/test-utils/transaction-fixtures";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import { makeTransaction } from "@/test-utils/transaction-fixtures";
import TransactionsPage from "@/pages/transactions";

const salario = makeLabel({ id: "c0000000-0000-4000-8000-0000000000a1", name: "Salário", kind: "revenue" });
const mercado = makeLabel({ id: "c0000000-0000-4000-8000-0000000000a2", name: "Mercado", kind: "expense" });
const nubank = makeAccount({ id: "a0000000-0000-4000-8000-000000000001", name: "Nubank" });
const orcamento = makeBudget({ id: "b0000000-0000-4000-8000-0000000000a1", name: "Orcamento qualquer" });
const salarioEsperado = makeReminder({ id: "d0000000-0000-4000-8000-0000000000c1", name: "Salario esperado", type: "deposit" });

function renderPage(transactions: Transaction[] = [], bills = [salarioEsperado]) {
  const accounts = [nubank];
  const tx = fakeTransactionsApi(transactions, accounts);
  const recurrences = fakeRecurrencesApi(bills);
  server.use(
    ...tx.handlers,
    ...fakeAccountsApi(accounts).handlers,
    ...fakeBudgetsApi([orcamento]).handlers,
    ...recurrences.handlers,
    ...fakeLabelsApi("categories", [salario, mercado]).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <WithSidebar route="/transacoes">
        <TransactionsPage />
      </WithSidebar>
    </FakeAuth>,
  );
  return Object.assign(tx, { recurrences });
}

const posts = (tx: ReturnType<typeof renderPage>) => tx.recurrences.state.requests.filter((r) => r.method === "POST");
const d = () => within(screen.getByRole("dialog"));
const type = (label: string | RegExp, text: string) => userEvent.type(d().getByLabelText(label), text);
const save = () => userEvent.click(d().getByRole("button", { name: "Salvar" }));

async function fill(description = "Salário de novembro", amount = "5.000,00") {
  await openIncomeForm();
  await pickChip(d(), "Conta", "Nubank");
  await type("Descrição", description);
  await type(/^Valor \(BRL\)/, amount);
}

it("abre com os campos de receita: Foi recebida e so categorias de entrada", async () => {
  renderPage();
  await openIncomeForm();
  expect(d().getByText("Foi recebida")).toBeInTheDocument();
  expect(d().getByRole("button", { name: "Hoje" })).toHaveAttribute("aria-pressed", "true");
  expect(d().getByRole("switch", { name: /Ignorar transação/ })).not.toBeChecked();
  await userEvent.click(d().getByRole("combobox", { name: "Categoria" }));
  const options = screen.getAllByRole("option").map((o) => o.textContent);
  expect(options).toContain("Salário");
  expect(options).not.toContain("Mercado");
});

it("cria uma receita recebida, usando a descricao como origem", async () => {
  const tx = renderPage();
  await fill();
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({
    type: "deposit",
    description: "Salário de novembro",
    amount: "5000.00",
    counterparty_name: "Salário de novembro",
    is_paid: true,
    ignored: false,
    date: appToday(),
  });
});

it("Não foi recebida e Ignorar transação vão para o corpo do pedido", async () => {
  const tx = renderPage();
  await fill();
  await userEvent.click(d().getByRole("switch", { name: /Foi recebida/ }));
  expect(d().getByText("Não foi recebida")).toBeInTheDocument();
  await userEvent.click(d().getByRole("switch", { name: /Ignorar transação/ }));
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({ type: "deposit", is_paid: false, ignored: true });
});

it("em Mais detalhes pergunta de quem veio, sem orcamento e sem campo de conta a pagar", async () => {
  renderPage();
  await openIncomeForm();
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  expect(d().getByLabelText("De quem")).toBeInTheDocument();
  expect(d().queryByLabelText("Orçamento")).not.toBeInTheDocument();
  expect(d().queryByLabelText("Recebimento esperado")).not.toBeInTheDocument();
  expect(d().getByRole("switch", { name: "Receita fixa" })).toBeInTheDocument();
  expect(d().getByRole("switch", { name: "Repetir" })).toBeInTheDocument();
});

it("Receita fixa cria uma recorrente de entrada, mensal e sem data final", async () => {
  const tx = renderPage();
  await fill("Salário", "5.000,00");
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  await userEvent.click(d().getByRole("switch", { name: "Receita fixa" }));
  await save();
  await waitFor(() => expect(posts(tx)).toHaveLength(1));
  expect(tx.state.writes).toHaveLength(0);
  const body = posts(tx)[0]!.body as { frequency: string; max_occurrences: number | null; template: { splits: { type: string }[] } };
  expect(body).toMatchObject({ name: "Salário", auto_create: true, frequency: "monthly", max_occurrences: null });
  expect(body.template.splits[0]!.type).toBe("deposit");
});

it("editar uma receita nao recebida e ignorada mantem as marcas", async () => {
  const original = makeTransaction({}, [
    deposit({
      description: "Freela",
      amount: "800.00",
      destination_account_id: nubank.id,
      destination_account_name: "Nubank",
      source_account_name: "Cliente",
      is_paid: false,
      ignored: true,
    }),
  ]);
  const tx = renderPage([original]);
  await userEvent.click(await screen.findByRole("button", { name: /Ações/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));
  const dialog = await screen.findByRole("dialog", { name: "Editar receita" });
  expect(within(dialog).getByText("Não foi recebida")).toBeInTheDocument();
  expect(within(dialog).getByRole("switch", { name: /Ignorar transação/ })).toBeChecked();
  await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]).toMatchObject({ method: "PUT" });
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({ type: "deposit", is_paid: false, ignored: true });
});

it("Efetivar numa receita nao recebida mostra Nao recebida e depois some", async () => {
  const original = makeTransaction({}, [
    deposit({ description: "Freela", destination_account_id: nubank.id, destination_account_name: "Nubank", is_paid: false }),
  ]);
  const tx = renderPage([original]);
  expect(await screen.findByText("Não recebida")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Ações/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Efetivar" }));
  await waitFor(() => expect(tx.state.settled).toEqual([original.id]));
  await waitFor(() => expect(screen.queryByText("Não recebida")).not.toBeInTheDocument());
});
