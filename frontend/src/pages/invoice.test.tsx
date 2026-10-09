import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBillsApi } from "@/test-utils/bills-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeInvoicesApi, makeInvoice, makeInvoiceSplit } from "@/test-utils/invoices-api";
import { fakeLabelsApi } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import InvoicePage from "./invoice";

const cartao = makeAccount({
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Nubank cartao",
  role: "credit_card",
  closing_day: 10,
  due_day: 17,
});
const corrente = makeAccount({ id: "a0000000-0000-4000-8000-000000000002", name: "Conta corrente" });

function renderPage({
  invoice = makeInvoice(),
  accounts = [cartao, corrente],
}: { invoice?: ReturnType<typeof makeInvoice> | null; accounts?: ReturnType<typeof makeAccount>[] } = {}) {
  const accountsApi = fakeAccountsApi(accounts);
  const invoicesApi = fakeInvoicesApi(invoice);
  const tx = fakeTransactionsApi([], accounts);
  server.use(
    ...accountsApi.handlers,
    ...invoicesApi.handlers,
    ...tx.handlers,
    ...fakeBudgetsApi([]).handlers,
    ...fakeBillsApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter initialEntries={[`/contas/${cartao.id}/fatura`]}>
        <Routes>
          <Route path="/contas/:accountId/fatura" element={<InvoicePage />} />
        </Routes>
      </MemoryRouter>
    </FakeAuth>,
  );
  return { accountsApi, invoicesApi, tx };
}

it("mostra total, periodo, vencimento e as compras da fatura", async () => {
  renderPage({
    invoice: makeInvoice({
      total: "123.45",
      period_start: "2026-02-11",
      period_end: "2026-03-10",
      due_date: "2026-03-17",
      splits: [makeInvoiceSplit({ description: "Mercado", amount: "123.45", date: "2026-03-01" })],
    }),
  });

  expect((await screen.findAllByText("R$ 123,45")).length).toBeGreaterThan(0);
  expect(screen.getByText(/11\/02\/2026.*10\/03\/2026/)).toBeInTheDocument();
  expect(screen.getByText("17/03/2026")).toBeInTheDocument();
  expect(screen.getByText("Mercado")).toBeInTheDocument();
});

it("fatura sem compras mostra o aviso", async () => {
  renderPage({ invoice: makeInvoice({ splits: [] }) });
  expect(await screen.findByText("Nenhuma compra nessa fatura")).toBeInTheDocument();
});

it("conta sem fechamento ou vencimento mostra o aviso para configurar", async () => {
  renderPage({
    accounts: [makeAccount({ id: cartao.id, name: "Nubank cartao", role: "credit_card" })],
  });
  expect(
    await screen.findByText("Esta conta ainda não tem dia de fechamento e de vencimento configurados. Edite a conta para ver a fatura."),
  ).toBeInTheDocument();
});

it("marcar como paga abre o formulario ja preenchido como transferencia para o cartao", async () => {
  renderPage({ invoice: makeInvoice({ total: "88.00" }) });
  await screen.findByText("R$ 88,00");
  await userEvent.click(screen.getByRole("button", { name: "Marcar fatura como paga" }));

  const dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getByRole("radio", { name: "Transferência" })).toBeChecked();
  expect(dialog.getByLabelText("Para a conta")).toHaveValue(cartao.id);
  expect(dialog.getByLabelText(/^Valor/)).toHaveValue("88,00");
});
