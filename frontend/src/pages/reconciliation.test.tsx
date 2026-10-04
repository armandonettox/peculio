import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeReconciliationApi, makeEntry } from "@/test-utils/reconciliation-api";
import ReconciliationPage from "./reconciliation";

// Data fixa: a data do extrato comeca em hoje e nao pode passar disso
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 31, 12));
});
afterEach(() => vi.useRealTimers());

function renderPage(entries: ReturnType<typeof makeEntry>[], accounts = [makeAccount({ name: "Nubank" })]) {
  const api = fakeReconciliationApi(entries);
  server.use(...api.handlers, ...fakeAccountsApi(accounts).handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <ReconciliationPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const user = userEvent.setup();
const clean = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const dialog = () => screen.getByRole("dialog");

async function statement(balance: string) {
  await screen.findByLabelText("Conta");
  await user.type(screen.getByLabelText(/Saldo do extrato/), balance);
  await user.click(screen.getByRole("button", { name: "Conferir" }));
}

const checkbox = (description: string) => screen.findByRole("checkbox", { name: `Conferido: ${description}` }) as Promise<HTMLInputElement>;
const figure = (label: RegExp) =>
  clean(within(screen.getByRole("region", { name: "Resumo" })).getByText(label).nextElementSibling?.textContent ?? null);

it("pede o saldo antes de conferir e nao chama o servidor", async () => {
  const api = renderPage([makeEntry("Mercado", -100)]);
  await screen.findByLabelText("Conta");
  await user.click(screen.getByRole("button", { name: "Conferir" }));
  expect(await screen.findByText("Informe o valor.")).toBeInTheDocument();
  expect(api.state.requests).toHaveLength(0);
});

it("a data do extrato nao pode ser no futuro", async () => {
  const api = renderPage([]);
  await screen.findByLabelText("Conta");
  await user.type(screen.getByLabelText(/Saldo do extrato/), "900");
  const date = screen.getByLabelText("Data do extrato");
  await user.clear(date);
  await user.type(date, "2026-04-15");
  await user.click(screen.getByRole("button", { name: "Conferir" }));
  expect(await screen.findByText("A data do extrato não pode ser no futuro.")).toBeInTheDocument();
  expect(api.state.requests).toHaveLength(0);
});

it("so contas de ativo aparecem na escolha", async () => {
  renderPage([], [makeAccount({ name: "Nubank" }), makeAccount({ name: "Cartao", type: "liability" }), makeAccount({ name: "Itau" })]);
  const select = (await screen.findByLabelText("Conta")) as HTMLSelectElement;
  expect([...select.options].map((option) => option.text)).toEqual(["Escolha a conta", "Nubank", "Itau"]);
});

it("mostra o extrato, o conferido e a diferenca", async () => {
  renderPage([makeEntry("Mercado", -100)]);
  await statement("900");
  expect(await screen.findByText("O conferido tem R$ 100,00 a mais do que o extrato.")).toBeInTheDocument();
  expect(figure(/Saldo do extrato em/)).toBe("R$ 900,00");
  expect(figure(/^Conferido$/)).toBe("R$ 1.000,00");
  expect(figure(/^Diferença$/)).toBe("-R$ 100,00");
  expect(screen.queryByRole("button", { name: "Fechar conciliação" })).not.toBeInTheDocument();
});

it("o saldo digitado vira texto da API e a data vai junto", async () => {
  const api = renderPage([]);
  await statement("1.234,50");
  await screen.findByText(/Não há lançamentos abertos/);
  const query = api.state.requests.find((request) => request.path === "/view")?.query;
  expect(query).toEqual({ statement_balance: "1234.50", statement_date: "2026-03-31" });
});

it("conferir um lancamento zera a diferenca e libera o fechamento", async () => {
  const api = renderPage([makeEntry("Mercado", -100)]);
  await statement("900");
  await user.click(await checkbox("Mercado"));
  expect(await screen.findByText("O conferido bate com o extrato.")).toBeInTheDocument();
  expect(await checkbox("Mercado")).toBeChecked();
  expect(screen.getByRole("button", { name: "Fechar conciliação" })).toBeEnabled();
  // Bateu: nao ha o que ajustar
  expect(screen.queryByRole("button", { name: "Criar lançamento de ajuste" })).not.toBeInTheDocument();
  expect(api.mutations()).toEqual([expect.objectContaining({ path: "/cleared", body: { split_ids: [api.state.entries[0].id], cleared: true } })]);
});

it("marcar todos e desmarcar todos", async () => {
  const api = renderPage([makeEntry("Mercado", -100), makeEntry("Salario", 50), makeEntry("Cafe", -5)]);
  await statement("1000");
  await user.click(await screen.findByRole("button", { name: "Marcar todos" }));
  await waitFor(() => expect(api.state.entries.every((entry) => entry.cleared)).toBe(true));
  expect(await screen.findByText("3 de 3 lançamentos conferidos")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Desmarcar todos" }));
  await waitFor(() => expect(api.state.entries.some((entry) => entry.cleared)).toBe(false));
});

it("o ajuste so e criado depois de confirmar", async () => {
  const api = renderPage([makeEntry("Mercado", -100, { cleared: true })]);
  await statement("880");
  await user.click(await screen.findByRole("button", { name: "Criar lançamento de ajuste" }));
  expect(clean(dialog().textContent)).toContain("uma saída de R$ 20,00");
  expect(api.mutations()).toHaveLength(0);

  await user.click(within(dialog()).getByRole("button", { name: "Criar ajuste" }));
  expect(await screen.findByText("O conferido bate com o extrato.")).toBeInTheDocument();
  expect(api.mutations()).toEqual([
    expect.objectContaining({ path: "/adjustment", body: { statement_balance: "880.00", statement_date: "2026-03-31" } }),
  ]);
  expect(await checkbox("Ajuste de conciliacao")).toBeChecked();
});

it("cancelar o ajuste nao cria nada", async () => {
  const api = renderPage([makeEntry("Mercado", -100, { cleared: true })]);
  await statement("880");
  await user.click(await screen.findByRole("button", { name: "Criar lançamento de ajuste" }));
  await user.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("fechar trava os lancamentos e registra no historico", async () => {
  const api = renderPage([makeEntry("Mercado", -100, { cleared: true })]);
  await statement("900");
  await user.click(await screen.findByRole("button", { name: "Fechar conciliação" }));
  expect(await screen.findByText("Conciliação fechada. 1 lançamento travado.")).toBeInTheDocument();
  expect(api.state.entries[0].locked).toBe(true);
  // Travado sai da lista; o fechamento aparece no historico
  expect(screen.queryByRole("checkbox", { name: "Conferido: Mercado" })).not.toBeInTheDocument();
  const history = await screen.findByRole("list");
  expect(clean(history.textContent)).toContain("Fechada");
  expect(clean(history.textContent)).toContain("1 lançamento travado");
});

it("sem nada conferido nao deixa fechar", async () => {
  renderPage([]);
  await statement("1000");
  expect(await screen.findByRole("button", { name: "Fechar conciliação" })).toBeDisabled();
  expect(screen.getByText("Marque ao menos um lançamento como conferido para fechar.")).toBeInTheDocument();
});

it("desfazer uma conciliacao destrava e marca como desfeita", async () => {
  const api = renderPage([makeEntry("Mercado", -100, { cleared: true })]);
  await statement("900");
  await user.click(await screen.findByRole("button", { name: "Fechar conciliação" }));
  await screen.findByText("Conciliação fechada. 1 lançamento travado.");

  await user.click(await screen.findByRole("button", { name: "Desfazer" }));
  expect(clean(dialog().textContent)).toContain("continuam marcados como conferidos");
  await user.click(within(dialog()).getByRole("button", { name: "Desfazer" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.state.entries[0].locked).toBe(false);
  expect(clean((await screen.findByRole("list")).textContent)).toContain("Desfeita");
  expect(screen.queryByRole("button", { name: "Desfazer" })).not.toBeInTheDocument();
  // O lancamento voltou para a lista, ainda conferido
  expect(await checkbox("Mercado")).toBeChecked();
});

it("mostra a mensagem do servidor quando conferir falha", async () => {
  const api = renderPage([makeEntry("Mercado", -100)]);
  await statement("900");
  const box = await checkbox("Mercado");
  api.state.nextMutationError = { status: 409, code: "transaction_locked" };
  await user.click(box);
  expect(await screen.findByText(/travado por uma conciliação/)).toBeInTheDocument();
  expect(await checkbox("Mercado")).not.toBeChecked();
});

it("erro ao carregar a conciliacao tem botao de tentar de novo", async () => {
  const api = renderPage([makeEntry("Mercado", -100)]);
  api.state.viewError = true;
  await statement("900");
  expect(await screen.findByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
});

it("trocar de conta esconde a conciliacao da anterior", async () => {
  renderPage([makeEntry("Mercado", -100)], [makeAccount({ name: "Nubank" }), makeAccount({ name: "Itau" })]);
  const select = (await screen.findByLabelText("Conta")) as HTMLSelectElement;
  await user.selectOptions(select, "Nubank");
  await user.type(screen.getByLabelText(/Saldo do extrato/), "900");
  await user.click(screen.getByRole("button", { name: "Conferir" }));
  await checkbox("Mercado");
  await user.selectOptions(select, "Itau");
  expect(screen.queryByRole("checkbox", { name: "Conferido: Mercado" })).not.toBeInTheDocument();
});

it("marcar todos e desmarcar todos so ficam ativos quando ha o que mudar", async () => {
  renderPage([makeEntry("Mercado", -100), makeEntry("Salario", 50)]);
  await statement("1000");
  await screen.findByRole("checkbox", { name: "Conferido: Mercado" });
  expect(screen.getByRole("button", { name: "Marcar todos" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Desmarcar todos" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Marcar todos" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Marcar todos" })).toBeDisabled());
  expect(screen.getByRole("button", { name: "Desmarcar todos" })).toBeEnabled();
});

it("enquanto o pedido esta no ar, a lista nao aceita outro clique", async () => {
  const api = renderPage([makeEntry("Mercado", -100), makeEntry("Salario", 50)]);
  await statement("1000");
  const box = await checkbox("Mercado");
  let release = () => {};
  api.state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await user.click(box);
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Conferido: Salario" })).toBeDisabled());
  expect(screen.getByRole("button", { name: "Marcar todos" })).toBeDisabled();
  release();
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Conferido: Salario" })).toBeEnabled());
});

it("o erro do servidor aparece no dialogo do ajuste sem fechar", async () => {
  const api = renderPage([makeEntry("Mercado", -100, { cleared: true })]);
  await statement("880");
  await user.click(await screen.findByRole("button", { name: "Criar lançamento de ajuste" }));
  api.state.nextMutationError = { status: 400, code: "reconciliation_no_difference" };
  await user.click(within(dialog()).getByRole("button", { name: "Criar ajuste" }));
  expect(await within(dialog()).findByText("Não há diferença para ajustar.")).toBeInTheDocument();
});
