import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import type { Transaction } from "@/api/transactions";
import { appToday, shiftDay } from "@/lib/dates";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth, WithSidebar, openTransferForm, pickChip } from "@/test-utils/providers";
import { fakeRecurrencesApi } from "@/test-utils/recurrences-api";
import { makeTransaction, transfer } from "@/test-utils/transaction-fixtures";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import TransactionsPage from "@/pages/transactions";

const viagem = makeLabel({ id: "t0000000-0000-4000-8000-0000000000c1", name: "viagem" });
const nubank = makeAccount({ id: "a0000000-0000-4000-8000-0000000000c1", name: "Nubank" });
const poupanca = makeAccount({ id: "a0000000-0000-4000-8000-0000000000c2", name: "Poupanca" });
const wise = makeAccount({ id: "a0000000-0000-4000-8000-0000000000c3", name: "Wise", currency_code: "USD" });
const velha = makeAccount({ id: "a0000000-0000-4000-8000-0000000000c4", name: "Conta velha", active: false });

function renderPage(transactions: Transaction[] = []) {
  const accounts = [nubank, poupanca, wise, velha];
  const tx = fakeTransactionsApi(transactions, accounts);
  const recurrences = fakeRecurrencesApi([]);
  server.use(
    ...tx.handlers,
    ...fakeAccountsApi(accounts).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...recurrences.handlers,
    ...fakeLabelsApi("categories", []).handlers,
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

const d = () => within(screen.getByRole("dialog"));
const amount = () => d().getByLabelText(/^Valor \((BRL|USD)\)/);
const save = () => userEvent.click(d().getByRole("button", { name: "Salvar" }));
const posts = (tx: ReturnType<typeof renderPage>) => tx.recurrences.state.requests.filter((r) => r.method === "POST");

it("abre com os campos de transferencia e so o essencial na primeira tela", async () => {
  renderPage();
  await openTransferForm();
  expect(d().getByRole("button", { name: "Hoje" })).toHaveAttribute("aria-pressed", "true");
  expect(d().getByRole("combobox", { name: "Conta de origem" })).toBeInTheDocument();
  expect(d().getByRole("combobox", { name: "Conta de destino" })).toBeInTheDocument();
  expect(d().getByRole("button", { name: "Salvar" })).toBeDisabled();
  // Transferencia nao tem pago, ignorar, categoria nem anexo
  expect(d().queryByText("Foi paga")).not.toBeInTheDocument();
  expect(d().queryByRole("switch", { name: /Ignorar/ })).not.toBeInTheDocument();
  expect(d().queryByLabelText("Categoria")).not.toBeInTheDocument();
  expect(d().queryByLabelText("Notas")).not.toBeInTheDocument();
});

it("Mais detalhes traz tags, notas, transferencia fixa e a descricao opcional", async () => {
  renderPage();
  await openTransferForm();
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  expect(d().getByRole("button", { name: "#viagem" })).toBeInTheDocument();
  expect(d().getByLabelText("Notas")).toBeInTheDocument();
  expect(d().getByRole("switch", { name: "Transferência fixa" })).toBeInTheDocument();
  expect(d().getByLabelText("Descrição")).toBeInTheDocument();
  expect(d().queryByRole("switch", { name: "Repetir" })).not.toBeInTheDocument();
});

it("cria a transferencia com a descricao padrao Origem e Destino", async () => {
  const tx = renderPage();
  await openTransferForm();
  await pickChip(d(), "Conta de origem", "Nubank");
  await pickChip(d(), "Conta de destino", "Poupanca");
  await userEvent.type(amount(), "25000");
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({
    type: "transfer",
    description: "Transferência: Nubank → Poupanca",
    amount: "250.00",
    account_id: nubank.id,
    counterparty_account_id: poupanca.id,
    date: appToday(),
  });
});

it("a descricao digitada vale mais que a padrao, e tags e notas vao junto", async () => {
  const tx = renderPage();
  await openTransferForm();
  await pickChip(d(), "Conta de origem", "Nubank");
  await pickChip(d(), "Conta de destino", "Poupanca");
  await userEvent.type(amount(), "1000");
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  await userEvent.type(d().getByLabelText("Descrição"), "Reserva de emergencia");
  await userEvent.click(d().getByRole("button", { name: "#viagem" }));
  await userEvent.type(d().getByLabelText("Notas"), "  mensal ");
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({
    description: "Reserva de emergencia",
    tag_ids: [viagem.id],
    notes: "mensal",
  });
});

it("a conta de destino nao lista a de origem e trocar a origem solta o destino igual", async () => {
  renderPage();
  await openTransferForm();
  await pickChip(d(), "Conta de origem", "Nubank");
  await userEvent.click(d().getByRole("combobox", { name: "Conta de destino" }));
  const names = screen.getAllByRole("option").map((o) => o.textContent);
  expect(names).not.toContain("Nubank");
  expect(names).toContain("Poupanca");
  await userEvent.click(screen.getByRole("option", { name: /^Poupanca/ }));
  expect(d().getByLabelText("Conta de destino")).toHaveTextContent("Poupanca");
  // Passar a origem para a Poupanca nao pode deixar o destino igual a ela
  await pickChip(d(), "Conta de origem", "Poupanca");
  expect(d().getByLabelText("Conta de destino")).not.toHaveTextContent("Poupanca");
});

it("sem destino mostra o erro, foca o campo e nao envia", async () => {
  const tx = renderPage();
  await openTransferForm();
  // O botao so liga com valor; com valor e sem destino, o envio mostra o que falta e foca o campo
  await userEvent.type(amount(), "100");
  await save();
  expect(await d().findByText("Escolha a conta de destino.")).toBeInTheDocument();
  expect(d().getByRole("combobox", { name: "Conta de destino" })).toHaveFocus();
  expect(tx.state.writes).toHaveLength(0);
});

it("entre moedas diferentes pede o valor que chega e envia os dois", async () => {
  const tx = renderPage();
  await openTransferForm();
  await pickChip(d(), "Conta de origem", "Nubank");
  await pickChip(d(), "Conta de destino", "Wise");
  await userEvent.type(amount(), "50000");
  const arriving = await d().findByLabelText(/Valor que chega/);
  await userEvent.type(arriving, "1000");
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({
    amount: "500.00",
    currency_code: "BRL",
    foreign_amount: "10.00",
    foreign_currency_code: "USD",
  });
});

it("o seletor de moeda leva a origem para uma conta daquela moeda", async () => {
  renderPage();
  await openTransferForm();
  await pickChip(d(), "Conta de origem", "Nubank");
  await userEvent.selectOptions(d().getByLabelText("Moeda"), "USD");
  expect(d().getByLabelText("Conta de origem")).toHaveTextContent("Wise");
  expect(d().getByText("US$")).toBeInTheDocument();
});

it("Ontem usa a data de ontem", async () => {
  const tx = renderPage();
  await openTransferForm();
  await pickChip(d(), "Conta de origem", "Nubank");
  await pickChip(d(), "Conta de destino", "Poupanca");
  await userEvent.type(amount(), "100");
  await userEvent.click(d().getByRole("button", { name: "Ontem" }));
  await save();
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]!.date).toBe(shiftDay(appToday(), -1));
});

it("Salvar e criar nova guarda e limpa o valor e o destino, mantendo a origem", async () => {
  const tx = renderPage();
  await openTransferForm();
  await pickChip(d(), "Conta de origem", "Nubank");
  await pickChip(d(), "Conta de destino", "Poupanca");
  await userEvent.type(amount(), "100");
  await userEvent.click(d().getByRole("button", { name: "Salvar e criar nova" }));
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(screen.getByRole("dialog", { name: "Nova transferência" })).toBeInTheDocument();
  await waitFor(() => expect(amount()).toHaveValue(""));
  expect(d().getByLabelText("Conta de destino")).not.toHaveTextContent("Poupanca");
  expect(d().getByLabelText("Conta de origem")).toHaveTextContent("Nubank");
});

it("transferencia fixa cria uma recorrente mensal, sem data final, e nao uma transferencia avulsa", async () => {
  const tx = renderPage();
  await openTransferForm();
  await pickChip(d(), "Conta de origem", "Nubank");
  await pickChip(d(), "Conta de destino", "Poupanca");
  await userEvent.type(amount(), "30000");
  await userEvent.click(d().getByRole("button", { name: /Mais detalhes/ }));
  await userEvent.click(d().getByRole("switch", { name: "Transferência fixa" }));
  expect(d().getByText("Cria todo mês, sem data final.")).toBeInTheDocument();
  await save();
  await waitFor(() => expect(posts(tx)).toHaveLength(1));
  expect(tx.state.writes).toHaveLength(0);
  const body = posts(tx)[0]!.body as { frequency: string; max_occurrences: number | null; template: { splits: { type: string }[] } };
  expect(body).toMatchObject({ auto_create: true, frequency: "monthly", max_occurrences: null, end_date: null });
  expect(body.template.splits[0]!.type).toBe("transfer");
});

it("editar abre com origem, destino e valor, e salva com PUT", async () => {
  const original = makeTransaction({}, [
    transfer({ source_account_id: nubank.id, destination_account_id: poupanca.id, description: "Reserva", amount: "80.00" }),
  ]);
  const tx = renderPage([original]);
  await screen.findByText("Reserva", { selector: "p" });
  await userEvent.click(screen.getByRole("button", { name: /Ações do lançamento Reserva/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));
  const dialog = await screen.findByRole("dialog", { name: "Editar transferência" });
  const inside = within(dialog);
  expect(inside.getByLabelText("Conta de origem")).toHaveTextContent("Nubank");
  expect(inside.getByLabelText("Conta de destino")).toHaveTextContent("Poupanca");
  expect(inside.getByLabelText(/^Valor \(BRL\)/)).toHaveValue("80,00");
  // A descricao propria abre os detalhes; Transferencia fixa so existe ao criar
  expect(inside.getByLabelText("Descrição")).toHaveValue("Reserva");
  expect(inside.queryByRole("switch", { name: "Transferência fixa" })).not.toBeInTheDocument();
  expect(inside.queryByRole("button", { name: "Salvar e criar nova" })).not.toBeInTheDocument();
  await userEvent.click(inside.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]).toMatchObject({ method: "PUT", id: original.id });
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({ type: "transfer", description: "Reserva", amount: "80.00" });
});

it("editar uma transferencia sem descricao propria abre sem os detalhes", async () => {
  const original = makeTransaction({}, [
    transfer({
      source_account_id: nubank.id,
      destination_account_id: poupanca.id,
      description: "Transferência: Nubank → Poupanca",
    }),
  ]);
  renderPage([original]);
  await userEvent.click(await screen.findByRole("button", { name: /Ações do lançamento/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));
  const dialog = await screen.findByRole("dialog", { name: "Editar transferência" });
  expect(within(dialog).queryByLabelText("Notas")).not.toBeInTheDocument();
});
