import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { LocationProbe } from "@/test-utils/location-probe";
import { server } from "@/test-utils/msw";
import { fakePlansApi, makeFakePlan } from "@/test-utils/plans-api";
import { FakeAuth } from "@/test-utils/providers";
import { fakeReportsApi } from "@/test-utils/reports-api";
import { PlanWizard } from "./plan-wizard";

const mercado = makeLabel({ name: "Mercado" });
const lazer = makeLabel({ name: "Lazer" });

function setup(plans = fakePlansApi({}, [mercado, lazer])) {
  server.use(
    ...plans.handlers,
    ...fakeLabelsApi("categories", [mercado, lazer]).handlers,
    ...fakeReportsApi().handlers,
    ...fakeAccountsApi([makeAccount()]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter initialEntries={["/orcamentos/planejar?mes=2026-03"]}>
        <PlanWizard />
        <LocationProbe />
      </MemoryRouter>
    </FakeAuth>,
  );
  return plans;
}

it("cria o planejamento: renda, limites por categoria e contagem do cartao", async () => {
  const user = userEvent.setup();
  const plans = setup();

  await user.type(await screen.findByLabelText("Quanto você ganha por mês?"), "500000");
  // 20% de economia por padrao: sobram 4.000,00 para gastar
  expect(screen.getByText(/4\.000,00/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Avançar" }));

  await user.type(await screen.findByLabelText("Limite de Mercado"), "150000");
  await user.type(screen.getByLabelText("Limite de Lazer"), "50000");
  await user.click(screen.getByRole("button", { name: "Avançar" }));

  await user.click(await screen.findByRole("radio", { name: /Pela data da fatura/ }));
  await user.click(screen.getByRole("button", { name: "Concluir" }));

  expect(await screen.findByText("Você criou seu planejamento mensal!")).toBeInTheDocument();
  const post = plans.state.requests.find((item) => item.method === "POST");
  expect(post?.path).toBe("/plans/monthly/2026-03");
  expect(post?.body).toMatchObject({ income: "5000.00", card_counting: "invoice" });
  expect(plans.state.plans["2026-03"].items.map((item) => item.name).sort()).toEqual(["Lazer", "Mercado"]);

  await user.click(screen.getByRole("button", { name: "Ver planejamento" }));
  expect(screen.getByTestId("location")).toHaveTextContent("/orcamentos?mes=2026-03");
});

it("nao deixa avancar quando os limites passam do orcamento de gastos", async () => {
  const user = userEvent.setup();
  setup();

  await user.type(await screen.findByLabelText("Quanto você ganha por mês?"), "100000");
  await user.click(screen.getByRole("button", { name: "Avançar" }));
  await user.type(await screen.findByLabelText("Limite de Mercado"), "90000");

  // Orcamento de gastos: 800,00. Passou 100,00.
  expect(screen.getByText(/Passou .*100,00 do orçamento de gastos/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Avançar" })).toBeDisabled();
});

it("a renda precisa ser maior que zero para avancar", async () => {
  setup();
  expect(await screen.findByRole("button", { name: "Avançar" })).toBeDisabled();
});

it("edita um planejamento que ja existe: troca limites, tira categoria e muda a economia", async () => {
  const user = userEvent.setup();
  const plans = setup(
    fakePlansApi(
      {
        "2026-03": makeFakePlan({
          items: [
            { category_id: mercado.id, name: "Mercado", amount: "1000.00", alert: true },
            { category_id: lazer.id, name: "Lazer", amount: "500.00", alert: false },
          ],
        }),
      },
      [mercado, lazer],
    ),
  );

  expect(await screen.findByRole("heading", { name: /Edição do planejamento mensal/ })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Avançar" }));

  // Tira o Lazer pelo gerenciador de categorias e muda o limite do Mercado
  await user.click(await screen.findByRole("button", { name: "Gerenciar categorias" }));
  await user.click(await screen.findByRole("checkbox", { name: /Lazer/ }));
  await user.click(screen.getByRole("button", { name: "Aplicar" }));
  const limit = await screen.findByLabelText("Limite de Mercado");
  await user.clear(limit);
  await user.type(limit, "120000");
  await user.click(screen.getByRole("button", { name: "Avançar" }));
  await user.click(await screen.findByRole("button", { name: "Concluir" }));

  expect(await screen.findByText("Você atualizou seu planejamento mensal!")).toBeInTheDocument();
  await waitFor(() => expect(plans.state.plans["2026-03"].items).toHaveLength(1));
  expect(plans.state.plans["2026-03"].items[0]).toMatchObject({ name: "Mercado", amount: "1200.00", alert: true });
  expect(plans.state.requests.some((item) => item.method === "DELETE")).toBe(true);
});

it("voltar na primeira etapa leva de volta aos orcamentos do mesmo mes", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole("button", { name: "Voltar" }));
  expect(screen.getByTestId("location")).toHaveTextContent("/orcamentos?mes=2026-03");
});
