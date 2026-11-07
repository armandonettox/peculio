import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi, makeBudget } from "@/test-utils/budgets-api";
import { server } from "@/test-utils/msw";
import { fakePlansApi, makeFakePlan } from "@/test-utils/plans-api";
import { FakeAuth } from "@/test-utils/providers";
import BudgetsPage from "./budgets";

function renderPage(entry = "/", plans = fakePlansApi()) {
  server.use(
    ...fakeBudgetsApi([makeBudget({ name: "Mercado" }), makeBudget({ name: "Reserva", carry_over: true })]).handlers,
    ...fakeAccountsApi([makeAccount()]).handlers,
    ...plans.handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter initialEntries={[entry]}>
        <BudgetsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
}

it("o Planejamento Personalizado mostra a lista de orcamentos, com e sem carrega sobra", async () => {
  renderPage("/?modo=personalizado");
  expect(await screen.findByRole("heading", { level: 1, name: "Orçamentos" })).toBeInTheDocument();
  expect(await screen.findByText("Mercado")).toBeInTheDocument();
  expect(screen.getByText("Reserva")).toBeInTheDocument();
  expect(screen.getByText("Carrega sobra")).toBeInTheDocument();
});

it("abre no Planejamento Mensal e, sem plano no mes, convida a criar um", async () => {
  renderPage("/?mes=2026-03");
  expect(await screen.findByText(/Nenhum orçamento definido para/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Definir novo planejamento" })).toBeInTheDocument();
  expect(screen.queryByText("Mercado")).not.toBeInTheDocument();
});

it("mostra o plano do mes com a tabela por categoria", async () => {
  renderPage(
    "/?mes=2026-03",
    fakePlansApi({
      "2026-03": makeFakePlan({ items: [{ category_id: "c1", name: "Mercado", amount: "1000.00", alert: false }] }),
    }),
  );
  expect(await screen.findByRole("region", { name: /Orçamento por categoria/ })).toBeInTheDocument();
  expect(screen.getByText("Mercado")).toBeInTheDocument();
  expect(screen.getByText("Categorias restantes")).toBeInTheDocument();
});

it("troca entre os dois tipos de planejamento pelo menu", async () => {
  const user = userEvent.setup();
  renderPage("/?mes=2026-03");
  await screen.findByText(/Nenhum orçamento definido para/);
  await user.click(screen.getByRole("button", { name: "Tipo de planejamento" }));
  await user.click(await screen.findByRole("menuitem", { name: "Planejamento Personalizado" }));
  expect(await screen.findByText("Mercado")).toBeInTheDocument();
});
