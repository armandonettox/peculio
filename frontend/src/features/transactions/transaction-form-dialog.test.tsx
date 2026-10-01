import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import type { Transaction } from "@/api/transactions";
import { todayLocal } from "@/lib/dates";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { deposit, makeTransaction, transfer } from "@/test-utils/transaction-fixtures";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import TransactionsPage from "@/pages/transactions";

const mercado = makeLabel({ id: "c0000000-0000-4000-8000-000000000001", name: "Mercado" });
const lazer = makeLabel({ id: "c0000000-0000-4000-8000-000000000002", name: "Lazer" });
const viagem = makeLabel({ id: "t0000000-0000-4000-8000-000000000001", name: "viagem" });
const casa = makeLabel({ id: "t0000000-0000-4000-8000-000000000002", name: "casa" });

const nubank = makeAccount({ id: "a0000000-0000-4000-8000-000000000001", name: "Nubank" });
const poupanca = makeAccount({ id: "a0000000-0000-4000-8000-000000000002", name: "Poupanca" });
const antiga = makeAccount({ id: "a0000000-0000-4000-8000-000000000003", name: "Conta velha", active: false });
const wise = makeAccount({ id: "a0000000-0000-4000-8000-000000000004", name: "Wise", currency_code: "USD" });
const financiamento = makeAccount({
  id: "a0000000-0000-4000-8000-000000000005",
  name: "Financiamento",
  type: "liability",
  role: "mortgage",
  balance: "-1000.00",
});

type Options = { transactions?: Transaction[]; accounts?: ReturnType<typeof makeAccount>[] };

function renderPage({ transactions = [], accounts = [nubank, poupanca, antiga, wise, financiamento] }: Options = {}) {
  const tx = fakeTransactionsApi(transactions, accounts);
  const accountsApi = fakeAccountsApi(accounts);
  server.use(
    ...tx.handlers,
    ...accountsApi.handlers,
    ...fakeLabelsApi("categories", [mercado, lazer]).handlers,
    ...fakeLabelsApi("tags", [viagem, casa]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter initialEntries={["/transacoes"]}>
        <TransactionsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return { tx, accountsApi };
}

async function openNew() {
  await userEvent.click(await screen.findByRole("button", { name: /Novo lançamento/ }));
  return await screen.findByRole("dialog", { name: "Novo lançamento" });
}

// Os campos do formulario ficam no dialogo; a pagina atras tem filtros com rotulos parecidos
const d = () => within(screen.getByRole("dialog"));

const type = (label: string | RegExp, text: string) => userEvent.type(d().getByLabelText(label), text);
const pick = (label: string | RegExp, option: string) => userEvent.selectOptions(d().getByLabelText(label), option);
const submit = () => userEvent.click(d().getByRole("button", { name: "Criar lançamento" }));

async function fillBasicExpense() {
  await openNew();
  await pick("Conta", "Nubank");
  await type("Descrição", "Compra no mercado");
  await type("Para quem", "Supermercado");
  await type(/^Valor \(BRL\)/, "1.234,50");
}

// ---------- Criar ----------

it("cria uma saida e mostra o novo lancamento na lista", async () => {
  const { tx } = renderPage();
  await fillBasicExpense();
  await pick("Categoria", "Mercado");
  await userEvent.click(d().getByRole("button", { name: "#viagem" }));
  await type("Notas", "  caixa grande ");
  await submit();

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(tx.state.writes).toHaveLength(1);
  expect(tx.state.writes[0].body.splits[0]).toMatchObject({
    type: "withdrawal",
    date: todayLocal(),
    description: "Compra no mercado",
    amount: "1234.50",
    currency_code: "BRL",
    account_id: nubank.id,
    counterparty_name: "Supermercado",
    category_id: mercado.id,
    tag_ids: [viagem.id],
    notes: "caixa grande",
  });
  expect(await screen.findByText("Compra no mercado", { selector: "p" })).toBeInTheDocument();
});

it("formulario vazio mostra os erros, foca o primeiro e nao chama a API", async () => {
  const { tx } = renderPage();
  await openNew();
  await pick("Conta", "Escolha...");
  await submit();

  expect(d().getByText("Escolha a conta.")).toBeInTheDocument();
  expect(d().getByText("Informe a descrição.")).toBeInTheDocument();
  expect(d().getByText("Informe para quem foi.")).toBeInTheDocument();
  expect(d().getByText("Informe o valor.")).toBeInTheDocument();
  expect(d().getByLabelText("Conta")).toHaveFocus();
  expect(tx.state.writes).toHaveLength(0);
});

it("o erro some quando o campo e corrigido", async () => {
  renderPage();
  await openNew();
  await submit();
  expect(d().getByText("Informe a descrição.")).toBeInTheDocument();
  await type("Descrição", "a");
  expect(screen.queryByText("Informe a descrição.")).not.toBeInTheDocument();
});

it("so oferece contas ativas ao criar", async () => {
  renderPage();
  await openNew();
  const options = within(d().getByLabelText("Conta")).getAllByRole("option").map((o) => o.textContent);
  expect(options).toContain("Nubank");
  expect(options).not.toContain("Conta velha (arquivada)");
});

it("entrada pergunta de quem veio e usa a conta que recebe", async () => {
  const { tx } = renderPage();
  await openNew();
  await userEvent.click(d().getByRole("radio", { name: "Entrada" }));
  await pick("Conta que recebe", "Nubank");
  await type("Descrição", "Salario");
  await type("De quem", "Empregador");
  await type(/^Valor/, "3000");
  await submit();

  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0].body.splits[0]).toMatchObject({
    type: "deposit",
    account_id: nubank.id,
    counterparty_name: "Empregador",
    amount: "3000.00",
  });
});

it("trocar o tipo limpa a outra ponta", async () => {
  renderPage();
  await openNew();
  await type("Para quem", "Supermercado");
  await userEvent.click(d().getByRole("radio", { name: "Entrada" }));
  expect(d().getByLabelText("De quem")).toHaveValue("");
});

it("sugere nomes ja usados ao digitar a contraparte", async () => {
  const { tx } = renderPage();
  tx.state.counterparties.push(
    { id: "1", name: "Supermercado Central", type: "expense" },
    { id: "2", name: "Salario", type: "revenue" },
  );
  await openNew();
  await type("Para quem", "Super");

  await waitFor(() => {
    const values = Array.from(document.querySelectorAll("#tx-counterparty-options option")).map((o) => o.getAttribute("value"));
    expect(values).toEqual(["Supermercado Central"]);
  });
  expect(tx.state.counterpartyRequests.at(-1)?.get("type")).toBe("expense");
});

// ---------- Transferencia ----------

it("transferencia entre contas na mesma moeda", async () => {
  const { tx } = renderPage();
  await openNew();
  await userEvent.click(d().getByRole("radio", { name: "Transferência" }));
  await pick("Conta", "Nubank");
  await type("Descrição", "Reserva");
  await pick("Para a conta", "Poupanca");
  await type(/^Valor/, "100");

  expect(d().queryByLabelText(/Valor que chega/)).not.toBeInTheDocument();
  expect(d().queryByRole("button", { name: "Dividir lançamento" })).not.toBeInTheDocument();
  await submit();

  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  const split = tx.state.writes[0].body.splits[0];
  expect(split).toMatchObject({ type: "transfer", account_id: nubank.id, counterparty_account_id: poupanca.id });
  expect(split).not.toHaveProperty("counterparty_name");
});

it("a conta de destino nao lista a propria conta de origem", async () => {
  renderPage();
  await openNew();
  await userEvent.click(d().getByRole("radio", { name: "Transferência" }));
  await pick("Conta", "Nubank");
  const options = within(d().getByLabelText("Para a conta")).getAllByRole("option").map((o) => o.textContent);
  expect(options).not.toContain("Nubank");
  expect(options).toContain("Poupanca");
});

it("transferencia entre moedas pede o valor que chega", async () => {
  const { tx } = renderPage();
  await openNew();
  await userEvent.click(d().getByRole("radio", { name: "Transferência" }));
  await pick("Conta", "Nubank");
  await type("Descrição", "Envio");
  await pick("Para a conta", "Wise - USD");
  await type(/^Valor \(BRL\)/, "500");

  const foreign = d().getByLabelText("Valor que chega em USD");
  await submit();
  expect(d().getByText("Informe o valor.")).toBeInTheDocument();
  expect(tx.state.writes).toHaveLength(0);

  await userEvent.type(foreign, "92,50");
  await submit();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0].body.splits[0]).toMatchObject({
    amount: "500.00",
    foreign_amount: "92.50",
    foreign_currency_code: "USD",
  });
});

// ---------- Divida ----------

it("pagar uma divida troca o nome por uma lista de dividas", async () => {
  const { tx } = renderPage();
  await openNew();
  await pick("Conta", "Nubank");
  await type("Descrição", "Parcela");
  await userEvent.click(d().getByRole("button", { name: "Pagar uma dívida" }));
  await pick("Dívida", "Financiamento");
  await type(/^Valor/, "400");
  await submit();

  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  const split = tx.state.writes[0].body.splits[0];
  expect(split).toMatchObject({ type: "withdrawal", counterparty_account_id: financiamento.id });
  expect(split).not.toHaveProperty("counterparty_name");
});

it("nao oferece pagar divida quando nao ha dividas", async () => {
  renderPage({ accounts: [nubank] });
  await openNew();
  expect(d().queryByRole("button", { name: "Pagar uma dívida" })).not.toBeInTheDocument();
});

it("receber de uma divida usa o texto de entrada", async () => {
  renderPage();
  await openNew();
  await userEvent.click(d().getByRole("radio", { name: "Entrada" }));
  await userEvent.click(d().getByRole("button", { name: "Receber de uma dívida" }));
  expect(d().getByLabelText("Dívida")).toBeInTheDocument();
  await userEvent.click(d().getByRole("button", { name: "Receber de um nome" }));
  expect(d().getByLabelText("De quem")).toBeInTheDocument();
});

// ---------- Dividir ----------

it("dividir lancamento: o valor vira o total, falta distribuir ate fechar e so entao salva", async () => {
  const { tx } = renderPage();
  await fillBasicExpense();
  await pick("Categoria", "Mercado");
  await userEvent.click(d().getByRole("button", { name: "Dividir lançamento" }));

  // A primeira linha herda descricao e categoria; o total fica no campo de cima
  expect(d().getByLabelText("Valor total (BRL)")).toHaveValue("1.234,50");
  expect(d().getByLabelText("Descrição da linha 1")).toHaveValue("Compra no mercado");
  expect(d().getByLabelText("Categoria da linha 1")).toHaveValue(mercado.id);
  expect(d().getByLabelText("Título (opcional)")).toBeInTheDocument();

  const amount1 = d().getByLabelText("Valor da linha 1");
  expect(amount1).toHaveValue("1.234,50");
  await userEvent.clear(amount1);
  await userEvent.type(amount1, "1000");
  expect(d().getByRole("status", { name: "" })).toHaveTextContent("Falta distribuir R$ 234,50");

  await userEvent.click(d().getByRole("button", { name: "Adicionar linha" }));
  await userEvent.type(d().getByLabelText("Descrição da linha 2"), "Limpeza");
  await userEvent.type(d().getByLabelText("Valor da linha 2"), "300");
  expect(d().getByRole("status", { name: "" })).toHaveTextContent("As linhas passam do total em R$ 65,50");

  await submit();
  expect(d().getByRole("alert")).toHaveTextContent("As linhas passam do total em R$ 65,50");
  expect(tx.state.writes).toHaveLength(0);

  const amount2 = d().getByLabelText("Valor da linha 2");
  await userEvent.clear(amount2);
  await userEvent.type(amount2, "234,50");
  expect(d().getByRole("status", { name: "" })).toHaveTextContent("Tudo distribuído.");
  await submit();

  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  const { body } = tx.state.writes[0];
  expect(body.title).toBe("Compra no mercado");
  expect(body.splits.map((s) => [s.description, s.amount, s.category_id])).toEqual([
    ["Compra no mercado", "1000.00", mercado.id],
    ["Limpeza", "234.50", null],
  ]);
});

it("cada linha da divisao mostra o proprio erro", async () => {
  renderPage();
  await fillBasicExpense();
  await userEvent.click(d().getByRole("button", { name: "Dividir lançamento" }));
  await userEvent.clear(d().getByLabelText("Descrição da linha 1"));
  await userEvent.clear(d().getByLabelText("Valor da linha 1"));
  await submit();
  expect(d().getByText("Informe a descrição.")).toBeInTheDocument();
  expect(d().getByText("Informe o valor.")).toBeInTheDocument();
});

it("remover linha so aparece com mais de uma, e desfazer a divisao volta ao lancamento simples", async () => {
  renderPage();
  await fillBasicExpense();
  await userEvent.click(d().getByRole("button", { name: "Dividir lançamento" }));
  expect(d().queryByRole("button", { name: /Remover linha/ })).not.toBeInTheDocument();

  await userEvent.click(d().getByRole("button", { name: "Adicionar linha" }));
  await userEvent.click(d().getByRole("button", { name: "Remover linha 2" }));
  expect(d().queryByLabelText("Descrição da linha 2")).not.toBeInTheDocument();

  await userEvent.click(d().getByRole("button", { name: "Desfazer divisão" }));
  expect(d().getByLabelText("Descrição")).toHaveValue("Compra no mercado");
  expect(d().getByRole("button", { name: "Dividir lançamento" })).toBeInTheDocument();
});

it("tags de uma linha ligam e desligam", async () => {
  renderPage();
  await fillBasicExpense();
  await userEvent.click(d().getByRole("button", { name: "Dividir lançamento" }));
  const group = d().getByRole("group", { name: "Tags da linha 1" });
  const tag = within(group).getByRole("button", { name: "#casa" });
  expect(tag).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(tag);
  expect(tag).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(tag);
  expect(tag).toHaveAttribute("aria-pressed", "false");
});

it("dividir continua disponivel ao pagar uma divida na mesma moeda", async () => {
  renderPage();
  await openNew();
  await userEvent.click(d().getByRole("button", { name: "Pagar uma dívida" }));
  expect(d().getByRole("button", { name: "Dividir lançamento" })).toBeInTheDocument();
});

it("dividir some quando a transferencia e entre moedas diferentes", async () => {
  renderPage();
  await openNew();
  await userEvent.click(d().getByRole("radio", { name: "Transferência" }));
  await pick("Conta", "Nubank");
  await pick("Para a conta", "Wise - USD");
  expect(d().queryByRole("button", { name: "Dividir lançamento" })).not.toBeInTheDocument();
});

// ---------- Erros do servidor ----------

it("erro de moeda do servidor aparece no campo do valor e o dialogo continua aberto", async () => {
  const { tx } = renderPage();
  tx.state.nextWriteError = { status: 422, code: "invalid_amount" };
  await fillBasicExpense();
  await submit();

  expect(await d().findByText("Valor inválido para esta moeda.")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("falha do servidor aparece no aviso do topo e nada se perde", async () => {
  const { tx } = renderPage();
  tx.state.nextWriteError = { status: 500, code: "internal_error" };
  await fillBasicExpense();
  await submit();

  expect(await d().findByRole("alert")).toBeInTheDocument();
  expect(d().getByLabelText("Descrição")).toHaveValue("Compra no mercado");
  // E tentar de novo funciona
  await submit();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("cancelar fecha sem gravar", async () => {
  const { tx } = renderPage();
  await fillBasicExpense();
  await userEvent.click(d().getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(tx.state.writes).toHaveLength(0);
});

// ---------- Editar ----------

const openEdit = async (title: string) => {
  await userEvent.click(await screen.findByRole("button", { name: `Ações do lançamento ${title}` }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));
  return await screen.findByRole("dialog", { name: "Editar lançamento" });
};

const saved = (extra: Parameters<typeof makeTransaction>[1] = [{}]) =>
  makeTransaction({}, [
    {
      description: "Padaria",
      amount: "12.50",
      source_account_id: nubank.id,
      source_account_name: "Nubank",
      destination_account_name: "Padaria do Ze",
      category_id: mercado.id,
      tag_ids: [casa.id],
      notes: "nota antiga",
      ...(extra[0] ?? {}),
    },
    ...extra.slice(1),
  ]);

it("editar reabre os campos e salva com PUT no mesmo lancamento", async () => {
  const transaction = saved();
  const { tx } = renderPage({ transactions: [transaction] });
  await screen.findByText("Padaria", { selector: "p" });
  await openEdit("Padaria");

  expect(d().getByLabelText("Conta")).toHaveValue(nubank.id);
  expect(d().getByLabelText("Descrição")).toHaveValue("Padaria");
  expect(d().getByLabelText("Para quem")).toHaveValue("Padaria do Ze");
  expect(d().getByLabelText(/^Valor/)).toHaveValue("12,50");
  expect(d().getByLabelText("Categoria")).toHaveValue(mercado.id);
  expect(d().getByRole("button", { name: "#casa" })).toHaveAttribute("aria-pressed", "true");
  expect(d().getByLabelText("Notas")).toHaveValue("nota antiga");

  const description = d().getByLabelText("Descrição");
  await userEvent.clear(description);
  await userEvent.type(description, "Padaria nova");
  await userEvent.click(d().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(tx.state.writes).toHaveLength(1);
  expect(tx.state.writes[0]).toMatchObject({ method: "PUT", id: transaction.id });
  expect(tx.state.writes[0].body.splits[0]).toMatchObject({
    description: "Padaria nova",
    amount: "12.50",
    category_id: mercado.id,
    tag_ids: [casa.id],
    notes: "nota antiga",
  });
  expect(await screen.findByText("Padaria nova", { selector: "p" })).toBeInTheDocument();
  expect(screen.queryByText("Padaria", { selector: "p" })).not.toBeInTheDocument();
});

it("editar uma entrada reabre com a conta que recebe", async () => {
  renderPage({
    transactions: [
      makeTransaction({}, [
        deposit({ destination_account_id: nubank.id, destination_account_name: "Nubank", description: "Salario" }),
      ]),
    ],
  });
  await screen.findByText("Salario", { selector: "p" });
  await openEdit("Salario");
  expect(d().getByRole("radio", { name: "Entrada" })).toBeChecked();
  expect(d().getByLabelText("Conta que recebe")).toHaveValue(nubank.id);
  expect(d().getByLabelText("De quem")).toHaveValue("Empregador");
});

it("editar uma transferencia reabre com a conta de destino", async () => {
  renderPage({
    transactions: [
      makeTransaction({}, [
        transfer({ source_account_id: nubank.id, destination_account_id: poupanca.id, description: "Reserva" }),
      ]),
    ],
  });
  await screen.findByText("Reserva", { selector: "p" });
  await openEdit("Reserva");
  expect(d().getByRole("radio", { name: "Transferência" })).toBeChecked();
  expect(d().getByLabelText("Para a conta")).toHaveValue(poupanca.id);
});

it("editar um lancamento dividido reabre as linhas e o titulo", async () => {
  const split = (description: string, amount: string) => ({
    description,
    amount,
    source_account_id: nubank.id,
    destination_account_id: "e0000000-0000-4000-8000-000000000001",
  });
  renderPage({
    transactions: [
      makeTransaction({ title: "Compras da semana" }, [split("Frutas", "60.00"), split("Limpeza", "40.00")]),
    ],
  });
  await screen.findByText("Compras da semana", { selector: "p" });
  await openEdit("Compras da semana");

  expect(d().getByLabelText("Título (opcional)")).toHaveValue("Compras da semana");
  expect(d().getByLabelText("Valor total (BRL)")).toHaveValue("100,00");
  expect(d().getByLabelText("Descrição da linha 1")).toHaveValue("Frutas");
  expect(d().getByLabelText("Valor da linha 2")).toHaveValue("40,00");
  expect(d().getByRole("status", { name: "" })).toHaveTextContent("Tudo distribuído.");
});

it("conta arquivada continua aparecendo ao editar", async () => {
  renderPage({
    transactions: [saved([{ source_account_id: antiga.id, source_account_name: "Conta velha" }])],
  });
  await screen.findByText("Padaria", { selector: "p" });
  await openEdit("Padaria");
  expect(d().getByLabelText("Conta")).toHaveValue(antiga.id);
});

it("lancamento que o formulario nao representa mostra o aviso e nao deixa salvar", async () => {
  const { tx } = renderPage({
    transactions: [
      makeTransaction({ title: "Misto" }, [
        { description: "a", source_account_id: nubank.id },
        { description: "b", source_account_id: poupanca.id },
      ]),
    ],
  });
  await screen.findByText("Misto", { selector: "p" });
  await openEdit("Misto");

  expect(d().getByRole("alert")).toHaveTextContent("só pode ser editado pela API");
  expect(d().queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
  await userEvent.click(d().getByRole("button", { name: "Cancelar" }));
  expect(tx.state.writes).toHaveLength(0);
});

it("o estado vazio tambem oferece criar o primeiro lancamento", async () => {
  renderPage();
  const empty = await screen.findByText("Nenhum lançamento ainda");
  const button = within(empty.closest("div") as HTMLElement).getByRole("button", { name: /Novo lançamento/ });
  await userEvent.click(button);
  expect(await screen.findByRole("dialog", { name: "Novo lançamento" })).toBeInTheDocument();
});
