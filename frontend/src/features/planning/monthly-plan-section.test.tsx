import { render, screen, waitFor, within } from "@testing-library/react";
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
import { MonthlyPlanSection } from "./monthly-plan-section";

const mercado = makeLabel({ name: "Mercado" });
const lazer = makeLabel({ name: "Lazer" });
const categories = [mercado, lazer];

function setup(plans = fakePlansApi({}, categories)) {
  const changes: string[] = [];
  server.use(
    ...plans.handlers,
    ...fakeLabelsApi("categories", categories).handlers,
    ...fakeReportsApi().handlers,
    ...fakeAccountsApi([makeAccount()]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <MonthlyPlanSection month="2026-03" onMonthChange={(month) => changes.push(month)} />
        <LocationProbe />
      </MemoryRouter>
    </FakeAuth>,
  );
  return { plans, changes };
}

const withMercado = () =>
  fakePlansApi(
    {
      "2026-03": makeFakePlan({ items: [{ category_id: mercado.id, name: "Mercado", amount: "1000.00", alert: false }] }),
    },
    categories,
  );

it("sem plano no mes, o botao leva ao assistente do mesmo mes", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole("button", { name: "Definir novo planejamento" }));
  expect(screen.getByTestId("location")).toHaveTextContent("/orcamentos/planejar?mes=2026-03");
});

it("copia o plano do mes anterior", async () => {
  const user = userEvent.setup();
  setup(
    fakePlansApi(
      { "2026-02": makeFakePlan({ items: [{ category_id: lazer.id, name: "Lazer", amount: "300.00", alert: false }] }) },
      categories,
    ),
  );
  await user.click(await screen.findByRole("button", { name: "Copiar planejamento do mês anterior" }));
  expect(await screen.findByText("Lazer")).toBeInTheDocument();
});

it("avisa quando o mes anterior nao tem plano para copiar", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole("button", { name: "Copiar planejamento do mês anterior" }));
  expect(await screen.findByText("O mês anterior não tem planejamento para copiar.")).toBeInTheDocument();
});

it("os botoes de mes avisam qual mes escolher", async () => {
  const user = userEvent.setup();
  const { changes } = setup();
  await user.click(await screen.findByRole("button", { name: "Mês anterior" }));
  await user.click(screen.getByRole("button", { name: "Próximo mês" }));
  expect(changes).toEqual(["2026-02", "2026-04"]);
});

it("novo orcamento: escolhe a categoria, define o limite e grava", async () => {
  const user = userEvent.setup();
  const { plans } = setup(withMercado());
  await user.click(await screen.findByRole("button", { name: "Novo orçamento" }));
  const dialog = await screen.findByRole("dialog");

  // Mercado ja tem limite: so o Lazer esta disponivel
  const select = within(dialog).getByLabelText("Categorias");
  await waitFor(() => expect(within(select).getByRole("option", { name: "Lazer" })).toBeInTheDocument());
  expect(within(select).queryByRole("option", { name: "Mercado" })).not.toBeInTheDocument();
  await user.selectOptions(select, "Lazer");
  await user.type(within(dialog).getByLabelText("Limite de Lazer"), "50000");
  await user.click(within(dialog).getByRole("switch"));
  await user.click(within(dialog).getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(plans.state.plans["2026-03"].items).toHaveLength(2));
  expect(plans.state.plans["2026-03"].items[1]).toMatchObject({ name: "Lazer", amount: "500.00", alert: true });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("novo orcamento: nao deixa gravar acima do orcamento de gastos", async () => {
  const user = userEvent.setup();
  setup(withMercado());
  await user.click(await screen.findByRole("button", { name: "Novo orçamento" }));
  const dialog = await screen.findByRole("dialog");
  const select = within(dialog).getByLabelText("Categorias");
  await waitFor(() => expect(within(select).getByRole("option", { name: "Lazer" })).toBeInTheDocument());
  await user.selectOptions(select, "Lazer");
  // Orcamento de gastos 4.000,00 - 1.000,00 ja limitados = 3.000,00 livres; 3.500,00 passa
  await user.type(within(dialog).getByLabelText("Limite de Lazer"), "350000");
  expect(within(dialog).getByRole("alert")).toHaveTextContent("passa do orçamento de gastos");
  expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeDisabled();
});

it("exclui o limite de uma categoria depois de confirmar", async () => {
  const user = userEvent.setup();
  const { plans } = setup(withMercado());
  await user.click(await screen.findByRole("button", { name: "Excluir limite de Mercado" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /Excluir/ }));
  await waitFor(() => expect(plans.state.plans["2026-03"].items).toHaveLength(0));
});

it("muda como o cartao e contado pelo menu", async () => {
  const user = userEvent.setup();
  const { plans } = setup(withMercado());
  await screen.findByText("Mercado");
  await user.click(screen.getByRole("button", { name: "Mais opções" }));
  await user.click(await screen.findByRole("menuitem", { name: "Visualização das despesas no cartão" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("radio", { name: /Pela data da fatura/ }));
  await user.click(within(dialog).getByRole("button", { name: /Salvar/ }));
  await waitFor(() => expect(plans.state.plans["2026-03"].card_counting).toBe("invoice"));
});

it("exclui todos os planejamentos depois de confirmar", async () => {
  const user = userEvent.setup();
  const { plans } = setup(withMercado());
  await screen.findByText("Mercado");
  await user.click(screen.getByRole("button", { name: "Mais opções" }));
  await user.click(await screen.findByRole("menuitem", { name: "Excluir planejamentos" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /Excluir/ }));
  await waitFor(() => expect(Object.keys(plans.state.plans)).toHaveLength(0));
  expect(await screen.findByText(/Nenhum orçamento definido para/)).toBeInTheDocument();
});
