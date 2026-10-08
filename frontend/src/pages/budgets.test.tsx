import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBillsApi } from "@/test-utils/bills-api";
import { fakeBudgetsApi, makeBudget } from "@/test-utils/budgets-api";
import { fakeEnvelopesApi } from "@/test-utils/envelopes-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import BudgetsEnvelopesPage from "./budgets";

// A pagina e em abas (Orcamentos, Envelopes); por padrao abre em Orcamentos
function renderPage() {
  server.use(
    ...fakeBudgetsApi([makeBudget({ name: "Mercado" })]).handlers,
    ...fakeAccountsApi([makeAccount()]).handlers,
    ...fakeEnvelopesApi([]).handlers,
    ...fakeBillsApi([]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <BudgetsEnvelopesPage />
      </MemoryRouter>
    </FakeAuth>,
  );
}

it("a pagina tem as duas abas e o comparativo entre os dois jeitos de orcar, Orcamentos ja aberta", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1, name: "Orçamentos e envelopes" })).toBeInTheDocument();
  for (const title of ["Orçamentos", "Envelopes"]) expect(screen.getByRole("tab", { name: title })).toBeInTheDocument();
  // O comparativo fica visivel nas duas abas, nao e um h2 (cada aba ja tem o proprio)
  expect(screen.getByText(/Um limite de gasto por categoria/)).toBeInTheDocument();
  expect(screen.getByText(/Voc[eê] distribui o dinheiro que j[aá] tem/)).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Orçamentos" })).toBeInTheDocument();
  expect(await screen.findByText("Mercado")).toBeInTheDocument();
});

it("clicar na aba Envelopes troca o conteudo, mantendo o h1 e o comparativo", async () => {
  renderPage();
  await screen.findByText("Mercado");
  await userEvent.click(screen.getByRole("tab", { name: "Envelopes" }));
  expect(await screen.findByRole("heading", { name: "Envelopes" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Orçamentos e envelopes" })).toBeInTheDocument();
  expect(screen.getByText(/Voc[eê] distribui o dinheiro que j[aá] tem/)).toBeInTheDocument();
  expect(screen.queryByText("Mercado")).not.toBeInTheDocument();
});
