import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi, makeBudget } from "@/test-utils/budgets-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import BudgetsPage from "./budgets";

function renderPage() {
  server.use(
    ...fakeBudgetsApi([makeBudget({ name: "Mercado" }), makeBudget({ name: "Reserva", carry_over: true })]).handlers,
    ...fakeAccountsApi([makeAccount()]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <BudgetsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
}

it("a pagina mostra o titulo e a lista de orcamentos, com e sem carrega sobra", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1, name: "Orçamentos" })).toBeInTheDocument();
  expect(await screen.findByText("Mercado")).toBeInTheDocument();
  expect(screen.getByText("Reserva")).toBeInTheDocument();
  expect(screen.getByText("Carrega sobra")).toBeInTheDocument();
});
