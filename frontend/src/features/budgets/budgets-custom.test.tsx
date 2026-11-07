import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeAccountsApi } from "@/test-utils/accounts-api";
import { fakeBudgetsApi, makeBudget } from "@/test-utils/budgets-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { BudgetsSection } from "./budgets-section";

const mercado = makeLabel({ name: "Mercado" });
const lazer = makeLabel({ name: "Lazer" });

function renderPage(budgets = [makeBudget({ name: "Mensal" })]) {
  const api = fakeBudgetsApi(budgets);
  server.use(...api.handlers, ...fakeAccountsApi([]).handlers, ...fakeLabelsApi("categories", [mercado, lazer]).handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <BudgetsSection />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());

async function openNew() {
  await userEvent.click(await screen.findByRole("button", { name: "Novo orçamento" }));
  await screen.findByRole("dialog");
}

it("cria um orcamento personalizado com datas, categorias e alerta", async () => {
  const api = renderPage();
  await openNew();

  await userEvent.type(inDialog().getByLabelText("Nome"), "Viagem");
  await userEvent.selectOptions(inDialog().getByLabelText("Período"), "Personalizado");
  await userEvent.type(inDialog().getByLabelText("Data inicial"), "2026-03-01");
  await userEvent.type(inDialog().getByLabelText("Data final"), "2026-03-31");
  await userEvent.type(inDialog().getByLabelText("Limite do período"), "250000");
  await waitFor(() => expect(within(inDialog().getByLabelText("Categorias")).getByRole("option", { name: "Mercado" })).toBeInTheDocument());
  await userEvent.selectOptions(inDialog().getByLabelText("Categorias"), "Mercado");
  expect(inDialog().getByRole("button", { name: "Tirar Mercado" })).toBeInTheDocument();
  await userEvent.click(inDialog().getByRole("switch", { name: "Receber alerta" }));
  await userEvent.click(inDialog().getByRole("button", { name: "Criar orçamento" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()[0].body).toEqual({
    name: "Viagem",
    currency_code: "BRL",
    amount: "2500.00",
    period: "custom",
    carry_over: false,
    category_ids: [mercado.id],
    alert: true,
    start_date: "2026-03-01",
    end_date: "2026-03-31",
  });
});

it("periodo personalizado pede as duas datas e a final nao pode ser antes da inicial", async () => {
  const api = renderPage();
  await openNew();
  await userEvent.type(inDialog().getByLabelText("Nome"), "Viagem");
  await userEvent.selectOptions(inDialog().getByLabelText("Período"), "Personalizado");
  await userEvent.type(inDialog().getByLabelText("Limite do período"), "10000");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar orçamento" }));
  expect(await inDialog().findByText("Informe a data inicial.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe a data final.")).toBeInTheDocument();

  await userEvent.type(inDialog().getByLabelText("Data inicial"), "2026-04-10");
  await userEvent.type(inDialog().getByLabelText("Data final"), "2026-04-01");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar orçamento" }));
  expect(await inDialog().findByText("A data final não pode ser antes da inicial.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("carregar sobra fica desligado e travado no periodo personalizado", async () => {
  renderPage();
  await openNew();
  await userEvent.click(inDialog().getByRole("checkbox", { name: /Carregar sobra/ }));
  expect(inDialog().getByLabelText("Período")).toBeDisabled();

  await userEvent.click(inDialog().getByRole("checkbox", { name: /Carregar sobra/ }));
  await userEvent.selectOptions(inDialog().getByLabelText("Período"), "Personalizado");
  expect(inDialog().getByRole("checkbox", { name: /Carregar sobra/ })).toBeDisabled();
  expect(inDialog().getByRole("checkbox", { name: /Carregar sobra/ })).not.toBeChecked();
});

it("as abas separam os ativos dos expirados", async () => {
  renderPage([
    makeBudget({ name: "Em curso", period: "custom", start_date: "2026-03-01", end_date: "2026-03-31" }),
    makeBudget({ name: "Velho", period: "custom", start_date: "2026-01-01", end_date: "2026-01-31", expired: true }),
  ]);
  expect(await screen.findByText("Em curso")).toBeInTheDocument();
  expect(screen.queryByText("Velho")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("tab", { name: "Expirados" }));
  expect(await screen.findByText("Velho")).toBeInTheDocument();
  expect(screen.queryByText("Em curso")).not.toBeInTheDocument();
  expect(screen.getByText("Expirado")).toBeInTheDocument();
});

it("sem orcamentos expirados, a aba explica quando eles aparecem", async () => {
  renderPage();
  await screen.findByText("Mensal");
  await userEvent.click(screen.getByRole("tab", { name: "Expirados" }));
  expect(await screen.findByText("Nenhum orçamento expirado")).toBeInTheDocument();
});

it("o cartao mostra as categorias e o selo de alerta", async () => {
  renderPage([makeBudget({ name: "Viagem", category_ids: [mercado.id, lazer.id], alert: true })]);
  const heading = await screen.findByRole("heading", { level: 2, name: "Viagem" });
  const item = heading.closest("li") as HTMLElement;
  await waitFor(() => expect(within(item).getByText("Categorias: Mercado, Lazer")).toBeInTheDocument());
  expect(within(item).getByText("Com alerta")).toBeInTheDocument();
});

it("ao editar, manda so categorias e alerta que mudaram", async () => {
  const api = renderPage([makeBudget({ name: "Viagem", category_ids: [mercado.id] })]);
  await userEvent.click(await screen.findByRole("button", { name: "Ações do orçamento Viagem" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));
  await screen.findByRole("dialog");

  await userEvent.click(await inDialog().findByRole("button", { name: "Tirar Mercado" }));
  await waitFor(() => expect(within(inDialog().getByLabelText("Categorias")).getByRole("option", { name: "Lazer" })).toBeInTheDocument());
  await userEvent.selectOptions(inDialog().getByLabelText("Categorias"), "Lazer");
  await userEvent.click(inDialog().getByRole("switch", { name: "Receber alerta" }));
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()[0].body).toEqual({ category_ids: [lazer.id], alert: true });
});

it("ao editar sem mudar nada, nao manda nada", async () => {
  const api = renderPage([makeBudget({ name: "Viagem", category_ids: [mercado.id, lazer.id] })]);
  await userEvent.click(await screen.findByRole("button", { name: "Ações do orçamento Viagem" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));
  await screen.findByRole("dialog");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(0);
});
