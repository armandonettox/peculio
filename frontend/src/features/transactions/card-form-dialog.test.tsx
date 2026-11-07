import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, it } from "vitest";

import type { InvoiceOption } from "@/api/invoices";
import type { Transaction } from "@/api/transactions";
import { appToday, formatDate, shiftDay } from "@/lib/dates";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeLabelsApi } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth, WithSidebar, openCardForm, pickChip } from "@/test-utils/providers";
import { fakeRecurrencesApi } from "@/test-utils/recurrences-api";
import { makeTransaction } from "@/test-utils/transaction-fixtures";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import TransactionsPage from "@/pages/transactions";

const itau = makeAccount({ id: "a0000000-0000-4000-8000-0000000000d1", name: "Itau" });
const visa = makeAccount({ id: "a0000000-0000-4000-8000-0000000000d2", name: "Visa", role: "credit_card", closing_day: 28, due_day: 5 });
const master = makeAccount({ id: "a0000000-0000-4000-8000-0000000000d3", name: "Master", role: "credit_card", closing_day: 10, due_day: 17 });
const velho = makeAccount({ id: "a0000000-0000-4000-8000-0000000000d4", name: "Cartao velho", role: "credit_card", closing_day: 1, due_day: 8, active: false });

const today = appToday();
// Tres faturas ao redor de hoje: a anterior, a aberta (contem hoje, e por isso tambem ontem) e a proxima
const previous: InvoiceOption = { period_start: shiftDay(today, -41), period_end: shiftDay(today, -11), due_date: shiftDay(today, -4), total: "0.00", status: "zero" };
const open: InvoiceOption = { period_start: shiftDay(today, -10), period_end: shiftDay(today, 20), due_date: shiftDay(today, 27), total: "180.00", status: "open" };
const next: InvoiceOption = { period_start: shiftDay(today, 21), period_end: shiftDay(today, 51), due_date: shiftDay(today, 58), total: "0.00", status: "partial" };

function renderPage(transactions: Transaction[] = [], accounts = [itau, visa, master, velho]) {
  const tx = fakeTransactionsApi(transactions, accounts);
  const requested: { accountId: string; around: string | null }[] = [];
  server.use(
    ...tx.handlers,
    ...fakeAccountsApi(accounts).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...fakeRecurrencesApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
    http.get("*/api/v1/accounts/:id/invoices", ({ params, request }) => {
      requested.push({ accountId: String(params.id), around: new URL(request.url).searchParams.get("around") });
      return HttpResponse.json([previous, open, next]);
    }),
  );
  render(
    <FakeAuth>
      <WithSidebar route="/transacoes">
        <TransactionsPage />
      </WithSidebar>
    </FakeAuth>,
  );
  return Object.assign(tx, { requested });
}

const d = () => within(screen.getByRole("dialog"));
const amount = () => d().getByLabelText(/^Valor \(BRL\)/);
const invoice = () => d().getByRole("combobox", { name: "Fatura" });
const save = () => userEvent.click(d().getByRole("button", { name: "Salvar" }));
const label = (item: InvoiceOption, status: string) => `Vence ${formatDate(item.due_date)} (${status})`;

it("abre com os campos do cartao: sem Foi paga nem anexo, com Ignorar e a fatura", async () => {
  renderPage();
  await openCardForm();
  expect(d().queryByText("Foi paga")).not.toBeInTheDocument();
  expect(d().queryByRole("button", { name: "Anexar arquivo" })).not.toBeInTheDocument();
  expect(d().getByRole("switch", { name: /Ignorar transação/ })).toBeInTheDocument();
  expect(d().getByRole("combobox", { name: "Cartão" })).toBeInTheDocument();
  expect(d().getByRole("button", { name: "Salvar e criar nova" })).toBeInTheDocument();
});

it("so oferece contas de cartao ativas, e ja vem com o primeiro cartao escolhido", async () => {
  renderPage();
  await openCardForm();
  expect(d().getByRole("combobox", { name: "Cartão" })).toHaveTextContent("Visa");
  await userEvent.click(d().getByRole("combobox", { name: "Cartão" }));
  const names = screen.getAllByRole("option").map((o) => o.textContent);
  expect(names).toEqual(expect.arrayContaining(["Visa", "Master"]));
  expect(names).not.toContain("Itau");
  expect(names).not.toContain("Cartao velho");
});

it("sem nenhum cartao cadastrado avisa como criar e nao envia", async () => {
  const tx = renderPage([], [itau]);
  await openCardForm();
  expect(await d().findByText(/Nenhum cartão de crédito cadastrado/)).toBeInTheDocument();
  await userEvent.type(amount(), "100");
  await userEvent.type(d().getByLabelText("Descrição"), "Compra");
  await save();
  expect(tx.state.writes).toHaveLength(0);
});

it("mostra as faturas com vencimento e situacao, e a que contem a data ja vem escolhida", async () => {
  renderPage();
  await openCardForm();
  await waitFor(() => expect(invoice()).toHaveTextContent(label(open, "Aberta")));
  await userEvent.click(invoice());
  // O formatador de moeda usa espaco nao separavel entre R$ e o valor
  const options = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent?.replace(/ /g, " "));
  expect(options).toEqual([
    `${label(previous, "Zerada")}`,
    `${label(open, "Aberta")}R$ 180,00`,
    `${label(next, "Parcial")}`,
  ]);
});

it("pede as faturas do cartao escolhido em volta da data da compra", async () => {
  const tx = renderPage();
  await openCardForm();
  await waitFor(() => expect(tx.requested.length).toBeGreaterThan(0));
  expect(tx.requested.at(-1)).toEqual({ accountId: visa.id, around: today });
});

it("sem escolher fatura a compra vai sem invoice_date, na fatura da data", async () => {
  const tx = renderPage();
  await openCardForm();
  await userEvent.type(amount(), "5000");
  await userEvent.type(d().getByLabelText("Descrição"), "Mercado");
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  const split = tx.state.writes[0]!.body.splits[0]!;
  expect(split).toMatchObject({ type: "withdrawal", account_id: visa.id, amount: "50.00", description: "Mercado" });
  expect(split).not.toHaveProperty("invoice_date");
  expect(tx.state.writes[0]!.body).not.toHaveProperty("installments");
});

it("escolher outra fatura grava invoice_date com o fim do periodo dela, e a data da compra fica", async () => {
  const tx = renderPage();
  await openCardForm();
  await waitFor(() => expect(invoice()).toHaveTextContent("Aberta"));
  await userEvent.type(amount(), "5000");
  await userEvent.type(d().getByLabelText("Descrição"), "Mercado");
  await userEvent.click(invoice());
  await userEvent.click(screen.getByRole("option", { name: new RegExp(`^${label(next, "Parcial").replace(/[()]/g, "\\$&")}`) }));
  expect(invoice()).toHaveTextContent("Parcial");
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({ date: today, invoice_date: next.period_end });
});

it("voltar para a fatura da propria data tira a escolha: o automatico", async () => {
  const tx = renderPage();
  await openCardForm();
  await waitFor(() => expect(invoice()).toHaveTextContent("Aberta"));
  await userEvent.type(amount(), "5000");
  await userEvent.type(d().getByLabelText("Descrição"), "Mercado");
  await userEvent.click(invoice());
  await userEvent.click(screen.getByRole("option", { name: /Parcial/ }));
  await userEvent.click(invoice());
  await userEvent.click(screen.getByRole("option", { name: /Aberta/ }));
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]).not.toHaveProperty("invoice_date");
});

it("sem escolha manual, mudar a data leva a compra para a fatura dessa data", async () => {
  renderPage();
  await openCardForm();
  await waitFor(() => expect(invoice()).toHaveTextContent("Aberta"));
  await userEvent.click(d().getByRole("button", { name: "Outros..." }));
  fireEvent.change(d().getByLabelText("Data", { selector: "input" }), { target: { value: shiftDay(today, -20) } });
  await waitFor(() => expect(invoice()).toHaveTextContent("Zerada"));
});

it("trocar de cartao solta a fatura escolhida e pede as faturas do novo cartao", async () => {
  const tx = renderPage();
  await openCardForm();
  await waitFor(() => expect(invoice()).toHaveTextContent("Aberta"));
  await userEvent.type(amount(), "5000");
  await userEvent.type(d().getByLabelText("Descrição"), "Mercado");
  await userEvent.click(invoice());
  await userEvent.click(screen.getByRole("option", { name: /Parcial/ }));
  await pickChip(d(), "Cartão", "Master");
  await waitFor(() => expect(tx.requested.at(-1)?.accountId).toBe(master.id));
  await waitFor(() => expect(invoice()).toHaveTextContent("Aberta"));
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  const split = tx.state.writes[0]!.body.splits[0]!;
  expect(split.account_id).toBe(master.id);
  expect(split).not.toHaveProperty("invoice_date");
});

it("se a lista de faturas falhar, a linha some e a compra segue pela data", async () => {
  const tx = renderPage();
  server.use(http.get("*/api/v1/accounts/:id/invoices", () => HttpResponse.json({ detail: "x", code: "account_not_credit_card" }, { status: 400 })));
  await openCardForm();
  await waitFor(() => expect(d().queryByRole("combobox", { name: "Fatura" })).not.toBeInTheDocument());
  await userEvent.type(amount(), "5000");
  await userEvent.type(d().getByLabelText("Descrição"), "Mercado");
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
});

it("Parcelado liga um campo de vezes e manda installments, com o valor total", async () => {
  const tx = renderPage();
  await openCardForm();
  await userEvent.type(amount(), "30000");
  await userEvent.type(d().getByLabelText("Descrição"), "Notebook");
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  await userEvent.click(d().getByRole("switch", { name: "Parcelado" }));
  const times = d().getByLabelText("vezes");
  expect(times).toHaveValue("2");
  await userEvent.clear(times);
  await userEvent.type(times, "3");
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body).toMatchObject({ installments: 3 });
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({ amount: "300.00", description: "Notebook" });
});

it("Parcelado com menos de 2 vezes mostra o erro e nao envia", async () => {
  const tx = renderPage();
  await openCardForm();
  await userEvent.type(amount(), "30000");
  await userEvent.type(d().getByLabelText("Descrição"), "Notebook");
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  await userEvent.click(d().getByRole("switch", { name: "Parcelado" }));
  await userEvent.clear(d().getByLabelText("vezes"));
  await userEvent.type(d().getByLabelText("vezes"), "1");
  await save();
  expect(await d().findByText("Informe um número de parcelas entre 2 e 60.")).toBeInTheDocument();
  expect(tx.state.writes).toHaveLength(0);
});

it("digitar 12 parcelas passa pelo 1 sem desligar o Parcelado nem esconder o campo", async () => {
  const tx = renderPage();
  await openCardForm();
  await userEvent.type(amount(), "120000");
  await userEvent.type(d().getByLabelText("Descrição"), "Geladeira");
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  await userEvent.click(d().getByRole("switch", { name: "Parcelado" }));
  await userEvent.clear(d().getByLabelText("vezes"));
  await userEvent.type(d().getByLabelText("vezes"), "1");
  expect(d().getByRole("switch", { name: "Parcelado" })).toBeChecked();
  await userEvent.type(d().getByLabelText("vezes"), "2");
  expect(d().getByLabelText("vezes")).toHaveValue("12");
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body).toMatchObject({ installments: 12 });
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({ amount: "1200.00" });
});

it("Parcelado e Despesa fixa se excluem, e nao ha Repetir no cartao", async () => {
  renderPage();
  await openCardForm();
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  expect(d().queryByRole("switch", { name: "Repetir" })).not.toBeInTheDocument();
  await userEvent.click(d().getByRole("switch", { name: "Parcelado" }));
  expect(d().getByRole("switch", { name: "Parcelado" })).toBeChecked();
  await userEvent.click(d().getByRole("switch", { name: "Despesa fixa" }));
  expect(d().getByRole("switch", { name: "Parcelado" })).not.toBeChecked();
  await userEvent.click(d().getByRole("switch", { name: "Parcelado" }));
  expect(d().getByRole("switch", { name: "Despesa fixa" })).not.toBeChecked();
});

it("a fatura escolhida vai junto no lancamento dividido, e sem Pagar uma divida no cartao", async () => {
  const tx = renderPage();
  await openCardForm();
  await waitFor(() => expect(invoice()).toHaveTextContent("Aberta"));
  await userEvent.type(amount(), "5000");
  await userEvent.click(invoice());
  await userEvent.click(screen.getByRole("option", { name: /Parcial/ }));
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  expect(d().queryByRole("button", { name: "Pagar uma dívida" })).not.toBeInTheDocument();
  await userEvent.click(d().getByRole("button", { name: "Dividir lançamento" }));
  await userEvent.clear(d().getByLabelText("Descrição da linha 1"));
  await userEvent.type(d().getByLabelText("Descrição da linha 1"), "A");
  await userEvent.click(d().getByRole("button", { name: "Adicionar linha" }));
  await userEvent.type(d().getByLabelText("Descrição da linha 2"), "B");
  await userEvent.clear(d().getByLabelText("Valor da linha 1"));
  await userEvent.type(d().getByLabelText("Valor da linha 1"), "3000");
  await userEvent.type(d().getByLabelText("Valor da linha 2"), "2000");
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  const splits = tx.state.writes[0]!.body.splits;
  expect(splits).toHaveLength(2);
  for (const split of splits) expect(split).toMatchObject({ invoice_date: next.period_end });
});

it("editar uma compra do cartao abre o formulario de cartao com a fatura escolhida e salva com PUT", async () => {
  const purchase = makeTransaction({}, [
    {
      description: "Notebook",
      amount: "300.00",
      source_account_id: visa.id,
      source_account_name: "Visa",
      destination_account_id: "e1",
      destination_account_name: "Loja",
      invoice_date: next.period_end,
    },
  ]);
  const tx = renderPage([purchase]);
  await userEvent.click(await screen.findByRole("button", { name: /Ações do lançamento Notebook/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));
  const dialog = await screen.findByRole("dialog", { name: "Editar despesa de cartão" });
  const inside = within(dialog);
  expect(inside.getByRole("combobox", { name: "Cartão" })).toHaveTextContent("Visa");
  await waitFor(() => expect(inside.getByRole("combobox", { name: "Fatura" })).toHaveTextContent("Parcial"));
  // Parcelar e criar nova so existem ao criar
  expect(inside.queryByRole("button", { name: "Salvar e criar nova" })).not.toBeInTheDocument();
  // Editar uma compra que ja tem conta a pagar solta abre os detalhes; abre se ainda estiverem fechados
  const more = inside.queryByRole("button", { name: /Mais detalhes/ });
  if (more) await userEvent.click(more);
  expect(inside.queryByRole("switch", { name: "Parcelado" })).not.toBeInTheDocument();
  await userEvent.click(inside.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]).toMatchObject({ method: "PUT", id: purchase.id });
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({ amount: "300.00", invoice_date: next.period_end });
});

it("editar uma compra sem fatura escolhida abre na fatura da data e salva sem invoice_date", async () => {
  const purchase = makeTransaction({}, [
    {
      description: "Cafe",
      amount: "12.00",
      date: today,
      source_account_id: visa.id,
      source_account_name: "Visa",
      destination_account_id: "e1",
      destination_account_name: "Padaria",
    },
  ]);
  const tx = renderPage([purchase]);
  await userEvent.click(await screen.findByRole("button", { name: /Ações do lançamento Cafe/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));
  const dialog = await screen.findByRole("dialog", { name: "Editar despesa de cartão" });
  await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Fatura" })).toHaveTextContent("Aberta"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]).not.toHaveProperty("invoice_date");
});

it("Salvar e criar nova guarda e limpa o formulario mantendo o cartao", async () => {
  const tx = renderPage();
  await openCardForm();
  await pickChip(d(), "Cartão", "Master");
  await userEvent.type(amount(), "5000");
  await userEvent.type(d().getByLabelText("Descrição"), "Mercado");
  await userEvent.click(d().getByRole("button", { name: "Salvar e criar nova" }));
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(screen.getByRole("dialog", { name: "Nova despesa de cartão" })).toBeInTheDocument();
  await waitFor(() => expect(amount()).toHaveValue(""));
  expect(d().getByRole("combobox", { name: "Cartão" })).toHaveTextContent("Master");
});
