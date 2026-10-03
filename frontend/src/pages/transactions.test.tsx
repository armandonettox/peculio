import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import type { Transaction } from "@/api/transactions";
import { appToday } from "@/lib/dates";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { LocationProbe } from "@/test-utils/location-probe";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { deposit, makeSplit, makeTransaction, transfer } from "@/test-utils/transaction-fixtures";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import TransactionsPage from "./transactions";

// O Intl escreve o espaco sem quebra (U+00A0) entre o simbolo e o numero, mas o Testing Library
// normaliza o texto da tela para espaco comum antes de comparar: as consultas usam espaco comum.
const nbsp = (text: string) => text;

const mercado = makeLabel({ id: "c0000000-0000-4000-8000-000000000001", name: "Mercado", color: "#E11D48" });
const viagem = makeLabel({ id: "t0000000-0000-4000-8000-000000000001", name: "viagem" });
const nubank = makeAccount({ id: "a0000000-0000-4000-8000-000000000001", name: "Nubank" });
const poupanca = makeAccount({ id: "a0000000-0000-4000-8000-000000000002", name: "Poupanca" });
const antiga = makeAccount({ id: "a0000000-0000-4000-8000-000000000003", name: "Conta velha", active: false });

type Options = { transactions?: Transaction[]; url?: string };

function renderPage({ transactions = [], url = "/transacoes" }: Options = {}) {
  const tx = fakeTransactionsApi(transactions);
  const accounts = fakeAccountsApi([nubank, poupanca, antiga]);
  const categories = fakeLabelsApi("categories", [mercado]);
  const tags = fakeLabelsApi("tags", [viagem]);
  server.use(tx.handler, ...accounts.handlers, ...categories.handlers, ...tags.handlers);
  render(
    <FakeAuth>
      <MemoryRouter initialEntries={[url]}>
        <TransactionsPage />
        <LocationProbe />
      </MemoryRouter>
    </FakeAuth>,
  );
  return tx;
}

const tx = (description: string, date = "2026-03-10", extra: Partial<Parameters<typeof makeSplit>[0]> = {}) =>
  makeTransaction({}, [{ description, date, ...extra }]);

const row = (text: string) => screen.getByText(text, { selector: "p" }).closest("li") as HTMLElement;
const location = () => screen.getByTestId("location").textContent ?? "";
const openFilters = () => userEvent.click(screen.getByRole("button", { name: /^Filtros/ }));

// ---------- Lista ----------

it("agrupa os lancamentos por dia, do mais recente para o mais antigo", async () => {
  renderPage({ transactions: [tx("Padaria", "2026-03-05"), tx("Mercado", "2026-03-10"), tx("Feira", "2026-03-10")] });
  await screen.findByText("Padaria");

  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings).toEqual(["Terça-feira, 10 de março de 2026", "Quinta-feira, 5 de março de 2026"]);
  const first = screen.getByRole("region", { name: "Terça-feira, 10 de março de 2026" });
  expect(within(first).getAllByRole("listitem")).toHaveLength(2);
});

it("chama o dia de hoje de Hoje", async () => {
  renderPage({ transactions: [tx("Cafe", appToday())] });
  expect(await screen.findByRole("heading", { level: 2, name: "Hoje" })).toBeInTheDocument();
});

it("saida mostra sinal de menos, a contraparte e a conta", async () => {
  renderPage({ transactions: [tx("Compra no mercado")] });
  await screen.findByText("Compra no mercado");
  const item = row("Compra no mercado");
  expect(within(item).getByText("Supermercado · Nubank")).toBeInTheDocument();
  const amount = within(item).getByText(nbsp("-R$ 50,00"));
  expect(amount).not.toHaveClass("text-positive");
});

it("entrada mostra sinal de mais em verde", async () => {
  renderPage({ transactions: [makeTransaction({}, [deposit()])] });
  await screen.findByText("Salario");
  const amount = within(row("Salario")).getByText(nbsp("+R$ 3.000,00"));
  expect(amount).toHaveClass("text-positive");
  expect(within(row("Salario")).getByText("Empregador · Nubank")).toBeInTheDocument();
});

it("transferencia mostra origem e destino, sem sinal e sem conta repetida", async () => {
  renderPage({ transactions: [makeTransaction({}, [transfer()])] });
  await screen.findByText("Reserva");
  const item = row("Reserva");
  expect(within(item).getByText("Nubank → Poupanca")).toBeInTheDocument();
  expect(within(item).getByText(nbsp("R$ 100,00"))).toBeInTheDocument();
});

it("transferencia entre moedas mostra o que saiu e o que chegou", async () => {
  const t = makeTransaction({}, [transfer({ amount: "500.00", foreign_amount: "100.00", foreign_currency_code: "USD" })]);
  renderPage({ transactions: [t] });
  await screen.findByText("Reserva");
  expect(within(row("Reserva")).getByText(`${nbsp("R$ 500,00")} → ${nbsp("US$ 100,00")}`)).toBeInTheDocument();
});

it("compra em outra moeda mostra o valor original", async () => {
  renderPage({ transactions: [tx("Hotel", "2026-03-10", { foreign_amount: "10.00", foreign_currency_code: "USD" })] });
  await screen.findByText("Hotel");
  expect(within(row("Hotel")).getByText(`Valor original: ${nbsp("US$ 10,00")}`)).toBeInTheDocument();
});

it("mostra a categoria com a cor escolhida e as tags", async () => {
  renderPage({ transactions: [tx("Compra", "2026-03-10", { category_id: mercado.id, tag_ids: [viagem.id] })] });
  await screen.findByText("Compra");
  const item = row("Compra");
  await waitFor(() => expect(within(item).getByText("Mercado")).toHaveAttribute("data-color", "#E11D48"));
  expect(within(item).getByText("#viagem")).toBeInTheDocument();
});

it("lancamento dividido mostra o total, o numero de partes e cada linha", async () => {
  const t = makeTransaction({ title: "Compras da semana" }, [
    { description: "Frutas", amount: "30.00", category_id: mercado.id },
    { description: "Limpeza", amount: "20.00" },
  ]);
  renderPage({ transactions: [t] });
  await screen.findByText("Compras da semana");
  const item = row("Compras da semana");
  expect(within(item).getByText("Dividida em 2 · Nubank")).toBeInTheDocument();
  expect(within(item).getAllByText(nbsp("-R$ 50,00"))).toHaveLength(1);
  expect(within(item).getByText("Frutas")).toBeInTheDocument();
  expect(within(item).getByText(nbsp("-R$ 30,00"))).toBeInTheDocument();
  expect(within(item).getByText(nbsp("-R$ 20,00"))).toBeInTheDocument();
});

it("divisao com sentidos misturados nao mostra total, so as linhas", async () => {
  const t = makeTransaction({ title: "Acerto" }, []);
  t.splits = [makeSplit({ description: "Pagou", amount: "10.00" }), deposit({ description: "Recebeu", amount: "25.00" })];
  renderPage({ transactions: [t] });
  await screen.findByText("Acerto");
  const item = row("Acerto");
  expect(within(item).getByText(nbsp("-R$ 10,00"))).toBeInTheDocument();
  expect(within(item).getByText(nbsp("+R$ 25,00"))).toBeInTheDocument();
});

it("mostra a contagem no singular e no plural", async () => {
  renderPage({ transactions: [tx("Um")] });
  expect(await screen.findByText("1 lançamento")).toBeInTheDocument();
});

it("mostra a contagem no plural", async () => {
  renderPage({ transactions: [tx("Um"), tx("Dois")] });
  expect(await screen.findByText("2 lançamentos")).toBeInTheDocument();
});

// ---------- Estados ----------

it("sem lancamentos mostra o estado vazio", async () => {
  renderPage();
  expect(await screen.findByText("Nenhum lançamento ainda")).toBeInTheDocument();
});

it("mostra o carregamento enquanto busca", () => {
  renderPage();
  // role="status" avisa leitores de tela; o <output> da sonda de rota tambem tem esse papel
  expect(screen.getByText("Carregando lançamentos...")).toHaveAttribute("role", "status");
});

it("erro ao listar mostra o aviso e permite tentar de novo", async () => {
  const api = renderPage({ transactions: [tx("Padaria")] });
  api.state.listError = true;
  expect(await screen.findByText("Algo deu errado do nosso lado. Tente novamente.")).toBeInTheDocument();

  api.state.listError = false;
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByText("Padaria")).toBeInTheDocument();
});

// ---------- Carregar mais ----------

const many = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    tx(`Compra ${String(index).padStart(2, "0")}`, `2026-02-${String(28 - Math.floor(index / 2)).padStart(2, "0")}`),
  );

it("a primeira pagina traz 25 e Carregar mais traz o resto sem repetir dia", async () => {
  const api = renderPage({ transactions: many(30) });
  await screen.findByText("30 lançamentos");
  expect(screen.getAllByRole("listitem").filter((li) => li.className.includes("shadow-sm"))).toHaveLength(25);

  await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
  await waitFor(() =>
    expect(screen.getAllByRole("listitem").filter((li) => li.className.includes("shadow-sm"))).toHaveLength(30),
  );
  expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  expect(api.state.requests.map((r) => r.get("offset"))).toEqual(["0", "25"]);

  // O mesmo dia nao aparece com dois titulos
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(new Set(headings).size).toBe(headings.length);
});

it("poucos lancamentos nao mostram Carregar mais", async () => {
  renderPage({ transactions: many(3) });
  await screen.findByText("3 lançamentos");
  expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
});

it("erro ao carregar mais mantem a lista e deixa tentar de novo", async () => {
  const api = renderPage({ transactions: many(30) });
  await screen.findByText("30 lançamentos");
  api.state.failOffsetOnce = 25;

  await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");
  expect(screen.getByText("Compra 00")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(await screen.findByText("Compra 29")).toBeInTheDocument();
});

// ---------- Filtros ----------

it("os filtros da URL ja vem aplicados, com o painel aberto", async () => {
  const api = renderPage({
    url: `/transacoes?conta=${nubank.id}&categoria=${mercado.id}&tag=${viagem.id}&de=2026-01-01&ate=2026-12-31&busca=pao&min=10.50&max=99.90`,
  });
  await screen.findByText("Nada encontrado");

  expect(api.params(0)).toMatchObject({
    account_id: nubank.id,
    category_id: mercado.id,
    tag_id: viagem.id,
    date_from: "2026-01-01",
    date_to: "2026-12-31",
    q: "pao",
    min_amount: "10.50",
    max_amount: "99.90",
  });
  expect(screen.getByRole("button", { name: "Filtros (7)" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByLabelText("Buscar lançamentos")).toHaveValue("pao");
  expect(screen.getByLabelText("Valor mínimo")).toHaveValue("10,50");
  expect(screen.getByLabelText("Data inicial")).toHaveValue("2026-01-01");
  expect(await screen.findByLabelText("Conta")).toHaveValue(nubank.id);
});

it("sem filtros o painel comeca fechado e a lista pede tudo", async () => {
  const api = renderPage({ transactions: [tx("Padaria")] });
  await screen.findByText("Padaria");
  expect(screen.getByRole("button", { name: "Filtros" })).toHaveAttribute("aria-expanded", "false");
  expect(api.params(0)).toEqual({ limit: "25", offset: "0" });
});

it("escolher uma conta filtra e grava na URL", async () => {
  const api = renderPage({
    transactions: [tx("No nubank", "2026-03-10", { source_account_id: nubank.id }), tx("Na poupanca", "2026-03-09", { source_account_id: poupanca.id })],
  });
  await screen.findByText("No nubank");
  await openFilters();
  await userEvent.selectOptions(await screen.findByRole("option", { name: "Nubank" }).then(() => screen.getByLabelText("Conta")), nubank.id);

  await waitFor(() => expect(screen.queryByText("Na poupanca")).not.toBeInTheDocument());
  expect(screen.getByText("No nubank")).toBeInTheDocument();
  expect(api.params()).toMatchObject({ account_id: nubank.id });
  expect(location()).toContain(`conta=${nubank.id}`);
  expect(screen.getByText("1 lançamento com os filtros escolhidos")).toBeInTheDocument();
});

it("conta arquivada aparece na lista de contas do filtro", async () => {
  renderPage({ transactions: [tx("x")] });
  await screen.findByText("x");
  await openFilters();
  expect(await screen.findByRole("option", { name: "Conta velha (arquivada)" })).toBeInTheDocument();
});

it("filtra por categoria e por tag", async () => {
  const api = renderPage({
    transactions: [
      tx("Com categoria", "2026-03-10", { category_id: mercado.id }),
      tx("Com tag", "2026-03-09", { tag_ids: [viagem.id] }),
      tx("Sem nada", "2026-03-08"),
    ],
  });
  await screen.findByText("Sem nada");
  await openFilters();
  await screen.findByRole("option", { name: "Mercado" });
  await userEvent.selectOptions(screen.getByLabelText("Categoria"), mercado.id);
  await waitFor(() => expect(screen.queryByText("Sem nada")).not.toBeInTheDocument());
  expect(screen.getByText("Com categoria")).toBeInTheDocument();
  expect(api.params()).toMatchObject({ category_id: mercado.id });

  await userEvent.selectOptions(screen.getByLabelText("Categoria"), "");
  await screen.findByText("Sem nada");
  await userEvent.selectOptions(screen.getByLabelText("Tag"), viagem.id);
  await waitFor(() => expect(screen.queryByText("Sem nada")).not.toBeInTheDocument());
  expect(screen.getByText("Com tag")).toBeInTheDocument();
  expect(api.params()).toMatchObject({ tag_id: viagem.id });
});

it("filtra por periodo", async () => {
  const api = renderPage({ transactions: [tx("Janeiro", "2026-01-10"), tx("Marco", "2026-03-10")] });
  await screen.findByText("Janeiro");
  await openFilters();
  await userEvent.type(screen.getByLabelText("Data inicial"), "2026-02-01");
  await waitFor(() => expect(screen.queryByText("Janeiro")).not.toBeInTheDocument());
  expect(screen.getByText("Marco")).toBeInTheDocument();
  expect(api.params()).toMatchObject({ date_from: "2026-02-01" });
  expect(location()).toContain("de=2026-02-01");
});

it("periodo com a data inicial depois da final mostra o erro e nao busca", async () => {
  const api = renderPage({ transactions: [tx("Janeiro", "2026-01-10")] });
  await screen.findByText("Janeiro");
  await openFilters();
  await userEvent.type(screen.getByLabelText("Data inicial"), "2026-05-01");
  await waitFor(() => expect(screen.queryByText("Janeiro")).not.toBeInTheDocument());
  const before = api.state.requests.length;
  await userEvent.type(screen.getByLabelText("Data final"), "2026-04-01");

  expect(await screen.findByText("A data inicial é depois da data final.")).toBeInTheDocument();
  expect(screen.getByLabelText("Data inicial")).toHaveAttribute("aria-invalid", "true");
  expect(api.withParam("date_to")).toHaveLength(0);
  expect(api.state.requests.length).toBe(before);
});

it("a busca espera uma pausa na digitacao e depois filtra", async () => {
  const api = renderPage({ transactions: [tx("Padaria"), tx("Supermercado Central"), tx("Feira")] });
  await screen.findByText("Padaria");
  const before = api.state.requests.length;

  await userEvent.type(screen.getByLabelText("Buscar lançamentos"), "merc");
  expect(api.state.requests.length).toBe(before);

  await waitFor(() => expect(api.params()).toMatchObject({ q: "merc" }));
  await waitFor(() => expect(screen.queryByText("Padaria")).not.toBeInTheDocument());
  expect(screen.getByText("Supermercado Central")).toBeInTheDocument();
  expect(api.withParam("q")).toHaveLength(1);
  expect(location()).toContain("busca=merc");
});

it("valor minimo e maximo aceitam o formato brasileiro", async () => {
  const api = renderPage({
    transactions: [tx("Barato", "2026-03-10", { amount: "10.00" }), tx("Caro", "2026-03-09", { amount: "2000.00" })],
  });
  await screen.findByText("Barato");
  await openFilters();
  await userEvent.type(screen.getByLabelText("Valor mínimo"), "1.000,50");

  await waitFor(() => expect(api.params()).toMatchObject({ min_amount: "1000.50" }));
  await waitFor(() => expect(screen.queryByText("Barato")).not.toBeInTheDocument());
  expect(screen.getByText("Caro")).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("Valor máximo"), "3000");
  await waitFor(() => expect(api.params()).toMatchObject({ min_amount: "1000.50", max_amount: "3000.00" }));
});

it.each([
  ["abc", "Valor inválido."],
  ["10,555", "Use no máximo 2 casas decimais."],
])("valor %j mostra o erro e nao envia o filtro", async (typed, message) => {
  const api = renderPage({ transactions: [tx("x")] });
  await screen.findByText("x");
  await openFilters();
  await userEvent.type(screen.getByLabelText("Valor mínimo"), typed);

  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.getByLabelText("Valor mínimo")).toHaveAttribute("aria-invalid", "true");
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(api.withParam("min_amount")).toHaveLength(0);
});

it("apagar o valor tira o filtro", async () => {
  const api = renderPage({ transactions: [tx("x")], url: "/transacoes?min=10.00" });
  await screen.findByLabelText("Valor mínimo");
  await userEvent.clear(screen.getByLabelText("Valor mínimo"));
  await waitFor(() => expect(api.params()).not.toHaveProperty("min_amount"));
  expect(location()).not.toContain("min=");
});

it("filtros sem resultado mostram Nada encontrado e Limpar filtros traz tudo de volta", async () => {
  const api = renderPage({ transactions: [tx("Padaria")], url: "/transacoes?busca=zzz" });
  expect(await screen.findByText("Nada encontrado")).toBeInTheDocument();

  await userEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0]);

  expect(await screen.findByText("Padaria")).toBeInTheDocument();
  expect(screen.getByLabelText("Buscar lançamentos")).toHaveValue("");
  expect(api.params()).toEqual({ limit: "25", offset: "0" });
  expect(location()).toBe("/transacoes");
  expect(screen.queryByRole("button", { name: "Limpar filtros" })).not.toBeInTheDocument();
});

it("Limpar logo depois de digitar mais nao deixa o texto antigo voltar", async () => {
  // A busca "merc" ja esta na URL; o usuario digita mais e limpa antes da pausa de 300 ms acabar
  const api = renderPage({ transactions: [tx("Padaria")], url: "/transacoes?busca=merc" });
  await screen.findByText("Nada encontrado");
  const search = screen.getByLabelText("Buscar lançamentos");

  await userEvent.type(search, "ado");
  expect(search).toHaveValue("mercado");
  await userEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0]);
  await new Promise((resolve) => setTimeout(resolve, 450));

  expect(search).toHaveValue("");
  expect(location()).toBe("/transacoes");
  // Nenhuma busca com "mercado" chegou a sair, e a ultima chamada e sem filtro
  expect(api.state.requests.some((request) => request.get("q") === "mercado")).toBe(false);
  expect(api.params()).toEqual({ limit: "25", offset: "0" });
  expect(await screen.findByText("Padaria")).toBeInTheDocument();
});

it("Limpar filtros esvazia tambem os campos digitados", async () => {
  renderPage({ transactions: [tx("x")], url: "/transacoes?busca=pao&min=10.00&conta=" + nubank.id });
  await screen.findByLabelText("Valor mínimo");
  await userEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));

  await waitFor(() => expect(screen.getByLabelText("Buscar lançamentos")).toHaveValue(""));
  expect(screen.getByLabelText("Valor mínimo")).toHaveValue("");
  expect(screen.getByLabelText("Conta")).toHaveValue("");
});

it("o botao de filtros mostra quantos do painel estao ativos, sem contar a busca", async () => {
  renderPage({ transactions: [tx("x")], url: `/transacoes?busca=x&conta=${nubank.id}&de=2026-01-01` });
  await screen.findByLabelText("Buscar lançamentos");
  expect(screen.getByRole("button", { name: "Filtros (2)" })).toBeInTheDocument();
});
