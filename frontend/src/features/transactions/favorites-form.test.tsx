import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, it } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeFavoritesApi, makeFavorite } from "@/test-utils/favorites-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth, WithSidebar, openExpenseForm, openIncomeForm, pickChip } from "@/test-utils/providers";
import { fakeRecurrencesApi } from "@/test-utils/recurrences-api";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import TransactionsPage from "@/pages/transactions";

const mercado = makeLabel({ id: "c0000000-0000-4000-8000-0000000000b1", name: "Mercado", kind: "expense", icon: "shopping-cart" });
const salario = makeLabel({ id: "c0000000-0000-4000-8000-0000000000b2", name: "Salario", kind: "revenue" });
const nubank = makeAccount({ id: "a0000000-0000-4000-8000-0000000000b1", name: "Nubank" });
const itau = makeAccount({ id: "a0000000-0000-4000-8000-0000000000b2", name: "Itau" });
const velha = makeAccount({ id: "a0000000-0000-4000-8000-0000000000b3", name: "Conta velha", active: false });

type History = Parameters<typeof fakeFavoritesApi>[1];

function renderPage(favorites = [makeFavorite({ description: "Padaria", category_id: mercado.id, account_id: itau.id })], history: History = []) {
  const accounts = [nubank, itau, velha];
  const tx = fakeTransactionsApi([], accounts);
  const fav = fakeFavoritesApi(favorites, history);
  server.use(
    ...tx.handlers,
    ...fakeAccountsApi(accounts).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...fakeRecurrencesApi([]).handlers,
    ...fakeLabelsApi("categories", [mercado, salario]).handlers,
    ...fakeLabelsApi("tags", []).handlers,
    ...fav.handlers,
  );
  render(
    <FakeAuth>
      <WithSidebar route="/transacoes">
        <TransactionsPage />
      </WithSidebar>
    </FakeAuth>,
  );
  return { tx, fav };
}

const d = () => within(screen.getByRole("dialog"));
const description = () => d().getByRole("combobox", { name: "Descrição" });
const heart = () => d().getByRole("button", { name: /favorita|favoritos/i });
const save = () => userEvent.click(d().getByRole("button", { name: "Salvar" }));

it("nao busca sugestoes antes de digitar", async () => {
  const { fav } = renderPage();
  await openExpenseForm();
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(fav.state.suggestionQueries).toHaveLength(0);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("ao digitar mostra os favoritos primeiro e depois o que ja foi lancado", async () => {
  renderPage(
    [makeFavorite({ description: "Padaria Pao", category_id: mercado.id, account_id: itau.id })],
    [{ description: "Padaria da esquina", category_id: null, account_id: nubank.id }],
  );
  await openExpenseForm();
  await userEvent.type(description(), "pada");
  const list = await screen.findByRole("listbox", { name: "Sugestões de descrição" });
  const options = within(list).getAllByRole("option");
  expect(options.map((o) => o.textContent)).toEqual(["Padaria Pao (favorita)Mercado · Itau", "Padaria da esquinaNubank"]);
});

it("escolher uma sugestao preenche descricao, categoria e conta, e nao mexe no valor", async () => {
  renderPage();
  await openExpenseForm();
  await userEvent.type(d().getByLabelText(/^Valor \(BRL\)/), "1250");
  await userEvent.type(description(), "pad");
  await userEvent.click(await screen.findByRole("option", { name: /Padaria/ }));
  expect(description()).toHaveValue("Padaria");
  expect(d().getByLabelText("Categoria")).toHaveTextContent("Mercado");
  expect(d().getByLabelText("Conta")).toHaveTextContent("Itau");
  expect(d().getByLabelText(/^Valor \(BRL\)/)).toHaveValue("12,50");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("a sugestao escolhida e um favorito: o coracao ja aparece ligado", async () => {
  renderPage();
  await openExpenseForm();
  await userEvent.type(description(), "pad");
  await userEvent.click(await screen.findByRole("option", { name: /Padaria/ }));
  expect(heart()).toHaveAttribute("aria-pressed", "true");
});

it("uma sugestao so do historico nao liga o coracao", async () => {
  renderPage([], [{ description: "Feira", category_id: mercado.id, account_id: nubank.id }]);
  await openExpenseForm();
  await userEvent.type(description(), "fei");
  await userEvent.click(await screen.findByRole("option", { name: /Feira/ }));
  expect(d().getByLabelText("Conta")).toHaveTextContent("Nubank");
  expect(heart()).toHaveAttribute("aria-pressed", "false");
});

it("setas e Enter escolhem a sugestao sem o mouse", async () => {
  renderPage();
  await openExpenseForm();
  await userEvent.type(description(), "pad");
  await screen.findByRole("listbox");
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(description()).toHaveValue("Padaria");
  expect(d().getByLabelText("Conta")).toHaveTextContent("Itau");
});

it("Enter sem nenhuma sugestao em destaque envia o formulario", async () => {
  const { tx } = renderPage();
  await openExpenseForm();
  await pickChip(d(), "Conta", "Nubank");
  await userEvent.type(d().getByLabelText(/^Valor \(BRL\)/), "500");
  await userEvent.type(description(), "pad");
  await screen.findByRole("listbox");
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(tx.state.writes).toHaveLength(1));
  expect(tx.state.writes[0]!.body.splits[0]).toMatchObject({ description: "pad", amount: "5.00" });
});

it("Esc fecha so a lista de sugestoes e o dialogo continua aberto", async () => {
  renderPage();
  await openExpenseForm();
  await userEvent.type(description(), "pad");
  await screen.findByRole("listbox");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Nova despesa" })).toBeInTheDocument();
});

it("categoria de outro sentido ou conta arquivada da sugestao nao sao aplicadas", async () => {
  renderPage([], [{ description: "Estranha", category_id: salario.id, account_id: velha.id }]);
  await openExpenseForm();
  const accountBefore = d().getByLabelText("Conta").textContent;
  await userEvent.type(description(), "estr");
  await userEvent.click(await screen.findByRole("option", { name: /Estranha/ }));
  expect(description()).toHaveValue("Estranha");
  expect(d().getByLabelText("Categoria")).toHaveTextContent("Sem categoria");
  expect(d().getByLabelText("Conta").textContent).toBe(accountBefore);
});

it("o coracao ligado grava o favorito com categoria e conta ao salvar o lancamento", async () => {
  const { tx, fav } = renderPage([]);
  await openExpenseForm();
  await pickChip(d(), "Conta", "Nubank");
  await pickChip(d(), "Categoria", "Mercado");
  await userEvent.type(d().getByLabelText(/^Valor \(BRL\)/), "800");
  await userEvent.type(description(), "Cafe da tarde");
  await userEvent.click(heart());
  expect(heart()).toHaveAttribute("aria-pressed", "true");
  expect(fav.state.saves).toHaveLength(0);
  await save();
  await waitFor(() => expect(fav.state.saves).toHaveLength(1));
  expect(fav.state.saves[0]).toEqual({
    type: "withdrawal",
    description: "Cafe da tarde",
    category_id: mercado.id,
    account_id: nubank.id,
  });
  expect(tx.state.writes).toHaveLength(1);
  // O valor nunca vai para o favorito
  expect(fav.state.saves[0]).not.toHaveProperty("amount");
});

it("sem mexer no coracao nenhum favorito e gravado nem apagado", async () => {
  const { fav } = renderPage();
  await openExpenseForm();
  await pickChip(d(), "Conta", "Nubank");
  await userEvent.type(d().getByLabelText(/^Valor \(BRL\)/), "800");
  await userEvent.type(description(), "Cafe");
  await save();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(fav.state.saves).toHaveLength(0);
  expect(fav.state.deleted).toHaveLength(0);
});

it("digitar uma descricao que ja e favorita (ignorando maiuscula) mostra o coracao ligado", async () => {
  renderPage();
  await openExpenseForm();
  await userEvent.type(description(), "PADARIA");
  await waitFor(() => expect(heart()).toHaveAttribute("aria-pressed", "true"));
});

it("desligar o coracao de um favorito existente apaga o favorito ao salvar", async () => {
  const existing = makeFavorite({ description: "Padaria", category_id: mercado.id, account_id: itau.id });
  const { fav } = renderPage([existing]);
  await openExpenseForm();
  await pickChip(d(), "Conta", "Nubank");
  await userEvent.type(d().getByLabelText(/^Valor \(BRL\)/), "800");
  await userEvent.type(description(), "Padaria");
  await waitFor(() => expect(heart()).toHaveAttribute("aria-pressed", "true"));
  await userEvent.click(heart());
  expect(heart()).toHaveAttribute("aria-pressed", "false");
  expect(fav.state.deleted).toHaveLength(0);
  await save();
  await waitFor(() => expect(fav.state.deleted).toEqual([existing.id]));
});

it("favoritar de novo uma descricao que ja e favorita atualiza em vez de duplicar", async () => {
  const existing = makeFavorite({ description: "Padaria", category_id: null, account_id: null });
  const { fav } = renderPage([existing]);
  await openExpenseForm();
  await pickChip(d(), "Conta", "Nubank");
  await pickChip(d(), "Categoria", "Mercado");
  await userEvent.type(d().getByLabelText(/^Valor \(BRL\)/), "800");
  await userEvent.type(description(), "padaria");
  await waitFor(() => expect(heart()).toHaveAttribute("aria-pressed", "true"));
  // Desliga e liga de novo: a intencao e favoritar com a categoria e a conta de agora
  await userEvent.click(heart());
  await userEvent.click(heart());
  await save();
  await waitFor(() => expect(fav.state.saves).toHaveLength(1));
  expect(fav.state.items).toHaveLength(1);
  expect(fav.state.items[0]).toMatchObject({ category_id: mercado.id, account_id: nubank.id });
});

it("se o favorito falhar, o lancamento ja esta salvo e o aviso aparece", async () => {
  const { tx } = renderPage([]);
  server.use(http.post("*/api/v1/favorites", () => HttpResponse.json({ detail: "erro", code: "internal_error" }, { status: 500 })));
  await openExpenseForm();
  await pickChip(d(), "Conta", "Nubank");
  await userEvent.type(d().getByLabelText(/^Valor \(BRL\)/), "800");
  await userEvent.type(description(), "Cafe");
  await userEvent.click(heart());
  await save();
  expect(await d().findByText(/não foi possível atualizar o favorito/)).toBeInTheDocument();
  expect(tx.state.writes).toHaveLength(1);
  expect(d().queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
});

it("receita busca sugestoes de entrada e grava o favorito como entrada", async () => {
  const { fav } = renderPage([], [{ description: "Salario da firma", category_id: salario.id, account_id: itau.id }]);
  await openIncomeForm();
  await userEvent.type(description(), "sal");
  await screen.findByRole("option", { name: /Salario da firma/ });
  expect(fav.state.suggestionQueries.at(-1)).toMatchObject({ type: "deposit" });
  await userEvent.click(screen.getByRole("option", { name: /Salario da firma/ }));
  expect(d().getByLabelText("Categoria")).toHaveTextContent("Salario");
  await userEvent.type(d().getByLabelText(/^Valor \(BRL\)/), "300000");
  await userEvent.click(heart());
  await save();
  await waitFor(() => expect(fav.state.saves).toHaveLength(1));
  expect(fav.state.saves[0]).toMatchObject({ type: "deposit", description: "Salario da firma", account_id: itau.id });
});
