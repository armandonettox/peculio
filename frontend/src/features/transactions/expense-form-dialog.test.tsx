import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import type { Transaction } from "@/api/transactions";
import { appToday, shiftDay } from "@/lib/dates";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth, WithSidebar, openExpenseForm } from "@/test-utils/providers";
import { fakeRecurrencesApi } from "@/test-utils/recurrences-api";
import { makeTransaction } from "@/test-utils/transaction-fixtures";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import TransactionsPage from "@/pages/transactions";

const mercado = makeLabel({ id: "c0000000-0000-4000-8000-000000000001", name: "Mercado" });
const viagem = makeLabel({ id: "t0000000-0000-4000-8000-000000000001", name: "viagem" });
const nubank = makeAccount({ id: "a0000000-0000-4000-8000-000000000001", name: "Nubank" });
const wise = makeAccount({ id: "a0000000-0000-4000-8000-000000000009", name: "Wise", currency_code: "USD" });
const cartao = makeAccount({ id: "a0000000-0000-4000-8000-000000000006", name: "Cartao", role: "credit_card", closing_day: 28, due_day: 5 });

function renderPage(transactions: Transaction[] = [], accounts = [nubank, cartao]) {
  const tx = fakeTransactionsApi(transactions, accounts);
  const recurrences = fakeRecurrencesApi([]);
  server.use(
    ...tx.handlers,
    ...fakeAccountsApi(accounts).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...recurrences.handlers,
    ...fakeLabelsApi("categories", [mercado]).handlers,
    ...fakeLabelsApi("tags", [viagem]).handlers,
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

async function fill(description = "Padaria", amount = "12,50") {
  await openExpenseForm();
  await userEvent.selectOptions(d().getByLabelText("Conta"), "Nubank");
  await type("Descrição", description);
  await type(/^Valor \(BRL\)/, amount);
}

it("abre com os campos principais do formulario de despesa", async () => {
  renderPage();
  await openExpenseForm();
  expect(d().getByText("Foi paga")).toBeInTheDocument();
  expect(d().getByRole("button", { name: "Hoje" })).toHaveAttribute("aria-pressed", "true");
  expect(d().getByRole("button", { name: "Ontem" })).toBeInTheDocument();
  expect(d().getByRole("button", { name: "Outros..." })).toBeInTheDocument();
  expect(d().getByLabelText("Descrição")).toBeInTheDocument();
  expect(d().getByLabelText("Categoria")).toBeInTheDocument();
  expect(d().getByLabelText("Conta")).toBeInTheDocument();
  expect(d().getByRole("button", { name: "Anexar arquivo" })).toBeInTheDocument();
  expect(d().getByRole("switch", { name: /Ignorar transação/ })).not.toBeChecked();
  expect(d().getByRole("button", { name: "Salvar e criar nova" })).toBeInTheDocument();
  // Os extras ficam em "Mais detalhes"
  expect(d().queryByLabelText("Notas")).not.toBeInTheDocument();
});

it("Mais detalhes abre a segunda coluna com os campos que o Pecúlio tem a mais", async () => {
  renderPage();
  await openExpenseForm();
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  expect(d().getByLabelText("Para quem")).toBeInTheDocument();
  expect(d().getByLabelText("Notas")).toBeInTheDocument();
  expect(d().getByRole("button", { name: "#viagem" })).toBeInTheDocument();
  expect(d().getByRole("button", { name: "Dividir lançamento" })).toBeInTheDocument();
  expect(d().getByRole("switch", { name: "Despesa fixa" })).toBeInTheDocument();
  expect(d().getByRole("switch", { name: "Repetir" })).toBeInTheDocument();
  await userEvent.click(d().getByRole("button", { name: /Menos detalhes/ }));
  expect(d().queryByLabelText("Notas")).not.toBeInTheDocument();
});

it("cria uma despesa paga e nao ignorada, usando a descricao como local", async () => {
  const tx = renderPage();
  await fill();
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  const [split] = tx.state.writes[0]!.body.splits;
  expect(split).toMatchObject({
    type: "withdrawal",
    description: "Padaria",
    amount: "12.50",
    counterparty_name: "Padaria",
    is_paid: true,
    ignored: false,
    date: appToday(),
  });
});

it("Não foi paga e Ignorar transação vão para o corpo do pedido", async () => {
  const tx = renderPage();
  await fill();
  await userEvent.click(d().getByRole("switch", { name: /Foi paga/ }));
  expect(d().getByText("Não foi paga")).toBeInTheDocument();
  await userEvent.click(d().getByRole("switch", { name: /Ignorar transação/ }));
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({ is_paid: false, ignored: true });
});

it("Ontem usa a data de ontem e Outros mostra o campo de data", async () => {
  const tx = renderPage();
  await fill();
  await userEvent.click(d().getByRole("button", { name: "Ontem" }));
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]!.date).toBe(shiftDay(appToday(), -1));
});

it("Outros mostra o campo de data", async () => {
  renderPage();
  await openExpenseForm();
  expect(d().queryByLabelText("Data", { selector: "input" })).not.toBeInTheDocument();
  await userEvent.click(d().getByRole("button", { name: "Outros..." }));
  expect(d().getByLabelText("Data", { selector: "input" })).toBeInTheDocument();
});

it("o ícone de informação explica o que ignorar faz", async () => {
  renderPage();
  await openExpenseForm();
  expect(d().queryByText(/não será exibida nem considerada/)).not.toBeInTheDocument();
  await userEvent.click(d().getByRole("button", { name: "O que significa ignorar" }));
  expect(d().getByText(/não será exibida nem considerada/)).toBeInTheDocument();
});

it("sem valor os botoes de salvar ficam desativados e sair do campo mostra o erro", async () => {
  const tx = renderPage();
  await openExpenseForm();
  expect(d().getByRole("button", { name: "Salvar" })).toBeDisabled();
  expect(d().getByRole("button", { name: "Salvar e criar nova" })).toBeDisabled();
  await userEvent.click(d().getByLabelText(/^Valor \(BRL\)/));
  await userEvent.click(d().getByLabelText("Descrição"));
  expect(await d().findByText("Informe o valor.")).toBeInTheDocument();
  await type(/^Valor \(BRL\)/, "5");
  expect(d().getByRole("button", { name: "Salvar" })).toBeEnabled();
  expect(d().getByRole("button", { name: "Salvar e criar nova" })).toBeEnabled();
  expect(tx.state.writes).toHaveLength(0);
});

it("mostra o simbolo da moeda na frente do valor", async () => {
  renderPage();
  await openExpenseForm();
  expect(d().getByText("R$")).toBeInTheDocument();
});

it("escolher outra moeda leva para uma conta dessa moeda e o valor passa a usar ela", async () => {
  const tx = renderPage([], [nubank, cartao, wise]);
  await openExpenseForm();
  const currency = d().getByLabelText("Moeda");
  expect(within(currency).getAllByRole("option").map((o) => o.textContent)).toEqual(["BRL", "USD"]);
  await userEvent.selectOptions(currency, "USD");
  expect(d().getByLabelText("Conta")).toHaveValue(wise.id);
  await type("Descrição", "Assinatura");
  await type(/^Valor \(USD\)/, "1000");
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({ currency_code: "USD", account_id: wise.id, amount: "10.00" });
});

it("Salvar e criar nova guarda e limpa o formulario sem fechar", async () => {
  const tx = renderPage();
  await fill();
  await userEvent.click(d().getByRole("button", { name: "Salvar e criar nova" }));
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(screen.getByRole("dialog", { name: "Nova despesa" })).toBeInTheDocument();
  await waitFor(() => expect(d().getByLabelText("Descrição")).toHaveValue(""));
});

it("despesa fixa e repetir se excluem e nada e enviado so por ligar", async () => {
  const tx = renderPage();
  await fill("Aluguel", "1.500,00");
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  await userEvent.click(d().getByRole("switch", { name: "Despesa fixa" }));
  expect(d().getByText("Cria todo mês, sem data final.")).toBeInTheDocument();
  // Fixa e repetir se excluem
  await userEvent.click(d().getByRole("switch", { name: "Repetir" }));
  expect(d().getByRole("switch", { name: "Despesa fixa" })).not.toBeChecked();
  expect(tx.state.writes).toHaveLength(0);
});

it("despesa fixa cria uma recorrente mensal sem data final", async () => {
  const tx = renderPage();
  await fill("Aluguel", "1.500,00");
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  await userEvent.click(d().getByRole("switch", { name: "Despesa fixa" }));
  await save();
  await waitFor(() => expect(posts(tx)).toHaveLength(1));
  expect(tx.state.writes).toHaveLength(0);
  expect(posts(tx)[0]!.body).toMatchObject({
    name: "Aluguel",
    auto_create: true,
    frequency: "monthly",
    first_date: appToday(),
    end_date: null,
    max_occurrences: null,
  });
});

it("repetir 3 vezes por semana cria uma recorrente com 3 ocorrencias", async () => {
  const tx = renderPage();
  await fill("Academia", "90,00");
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  await userEvent.click(d().getByRole("switch", { name: "Repetir" }));
  await userEvent.clear(d().getByLabelText("vezes"));
  await userEvent.type(d().getByLabelText("vezes"), "3");
  await userEvent.selectOptions(d().getByLabelText("Frequência"), "weekly");
  await save();
  await waitFor(() => expect(posts(tx)).toHaveLength(1));
  expect(posts(tx)[0]!.body).toMatchObject({ frequency: "weekly", max_occurrences: 3, end_date: null });
});

it("repetir com menos de 2 vezes mostra o erro e nao envia", async () => {
  const tx = renderPage();
  await fill("Academia", "90,00");
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  await userEvent.click(d().getByRole("switch", { name: "Repetir" }));
  await userEvent.clear(d().getByLabelText("vezes"));
  await userEvent.type(d().getByLabelText("vezes"), "1");
  await save();
  expect(await d().findByText("Informe de 2 a 999 vezes.")).toBeInTheDocument();
  expect(posts(tx)).toHaveLength(0);
});

it("editar uma despesa nao paga e ignorada mantem as marcas", async () => {
  const original = makeTransaction({}, [
    {
      description: "Padaria",
      amount: "12.50",
      source_account_id: nubank.id,
      source_account_name: "Nubank",
      destination_account_id: "e1",
      destination_account_name: "Padaria",
      is_paid: false,
      ignored: true,
    },
  ]);
  const tx = renderPage([original]);
  await userEvent.click(await screen.findByRole("button", { name: /Ações/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));
  const dialog = await screen.findByRole("dialog", { name: "Editar despesa" });
  expect(within(dialog).getByText("Não foi paga")).toBeInTheDocument();
  expect(within(dialog).getByRole("switch", { name: /Ignorar transação/ })).toBeChecked();
  await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]).toMatchObject({ method: "PUT" });
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({ is_paid: false, ignored: true });
});

it("Efetivar marca a despesa como paga e o selo some", async () => {
  const original = makeTransaction({}, [
    { description: "Padaria", source_account_id: nubank.id, source_account_name: "Nubank", is_paid: false },
  ]);
  const tx = renderPage([original]);
  expect(await screen.findByText("Não paga")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Ações/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Efetivar" }));
  await waitFor(() => expect(tx.state.settled).toEqual([original.id]));
  await waitFor(() => expect(screen.queryByText("Não paga")).not.toBeInTheDocument());
});
