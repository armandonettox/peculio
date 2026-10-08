import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeAccountsApi } from "@/test-utils/accounts-api";
import { fakeBillsApi, makeBill } from "@/test-utils/bills-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeLabelsApi } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeRecurrencesApi } from "@/test-utils/recurrences-api";
import BillsRecurrencesPage from "./bills";

// A pagina e em abas (Contas a pagar, Recorrentes); por padrao abre em Contas a pagar
function renderPage() {
  server.use(
    ...fakeBillsApi([makeBill({ name: "Netflix" })]).handlers,
    ...fakeAccountsApi([]).handlers,
    ...fakeRecurrencesApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
    ...fakeBudgetsApi([]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <BillsRecurrencesPage />
      </MemoryRouter>
    </FakeAuth>,
  );
}

it("a pagina tem as duas abas, Contas a pagar ja aberta", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1, name: "Contas a pagar e recorrentes" })).toBeInTheDocument();
  for (const title of ["Contas a pagar", "Recorrentes"]) expect(screen.getByRole("tab", { name: title })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Contas a pagar" })).toBeInTheDocument();
  expect(await screen.findByText("Netflix")).toBeInTheDocument();
});

it("clicar na aba Recorrentes troca o conteudo, mantendo o h1 da pagina", async () => {
  renderPage();
  await screen.findByText("Netflix");
  await userEvent.click(screen.getByRole("tab", { name: "Recorrentes" }));
  expect(await screen.findByRole("heading", { name: "Recorrentes" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Contas a pagar e recorrentes" })).toBeInTheDocument();
  expect(screen.queryByText("Netflix")).not.toBeInTheDocument();
});
