import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import type { Category } from "@/api/labels";
import type { Transaction } from "@/api/transactions";
import { appToday } from "@/lib/dates";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { newTestQueryClient } from "@/test-utils/providers";
import { deposit, makeTransaction, transfer } from "@/test-utils/transaction-fixtures";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import { TransactionsTable } from "./transactions-table";

const mercado = makeLabel({ id: "c1", name: "Mercado" }) as Category;
const lazer = makeLabel({ id: "c2", name: "Lazer" }) as Category;
const categories = new Map([
  [mercado.id, mercado],
  [lazer.id, lazer],
]);
const nubank = makeAccount({ id: "a1", name: "Nubank" });
const poupanca = makeAccount({ id: "a2", name: "Poupanca" });
const user = userEvent.setup();

const tx = (description: string, extra: Parameters<typeof makeTransaction>[1] = [{}]) =>
  makeTransaction({}, extra.map((split) => ({ description, source_account_id: "a1", ...split })));

function renderTable(items: Transaction[]) {
  const api = fakeTransactionsApi(items, [nubank, poupanca]);
  server.use(...api.handlers, ...fakeAccountsApi([nubank, poupanca]).handlers);
  const handlers = { onOpen: vi.fn(), onRemove: vi.fn() };
  render(
    <QueryClientProvider client={newTestQueryClient()}>
      <TransactionsTable items={items} categories={categories} accounts={[nubank, poupanca]} {...handlers} />
    </QueryClientProvider>,
  );
  return { ...handlers, api };
}

const rows = () => screen.getAllByRole("row").slice(1);
const rowOf = (name: RegExp) => screen.getByRole("row", { name });
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;
const newRow = () => screen.getByRole("row", { name: "Novo lançamento" });

async function openNewRow() {
  await user.click(screen.getByRole("button", { name: "Nova linha" }));
  return newRow();
}

async function fillNewRow({ description = "Padaria", counterparty = "Padaria do Ze", amount = "-12,50" } = {}) {
  await user.type(field("Descrição"), description);
  await user.type(field("Contraparte"), counterparty);
  await user.type(field("Valor"), amount);
}

// ---------- Leitura ----------

it("mostra uma linha por lancamento, com as colunas do dia a dia", () => {
  renderTable([tx("Mercado do mes", [{ amount: "50.00", category_id: "c1", destination_account_name: "Supermercado", source_account_name: "Nubank" }])]);
  const cells = within(rows()[0]).getAllByRole("cell");
  expect(cells.map((cell) => cell.textContent?.replace(/\s/g, " "))).toEqual([
    "10/03/2026",
    "Mercado do mes",
    "Supermercado",
    "Nubank",
    "Mercado",
    "-R$ 50,00",
    "",
  ]);
});

it("entrada leva sinal de mais e a cor positiva", () => {
  renderTable([makeTransaction({}, [deposit({ description: "Salario", amount: "1000.00" })])]);
  const amount = within(rows()[0]).getByText(/1\.000,00/);
  expect(amount.textContent?.replace(/\s/g, " ")).toBe("+R$ 1.000,00");
  expect(amount).toHaveClass("text-positive");
});

it("transferencia mostra origem e destino na contraparte e nao tem conta propria", () => {
  renderTable([makeTransaction({}, [transfer({ description: "Reserva", source_account_name: "Nubank", destination_account_name: "Poupanca" })])]);
  const cells = within(rows()[0]).getAllByRole("cell");
  expect(cells[2].textContent).toBe("Nubank → Poupanca");
  expect(cells[3].textContent).toBe("");
});

it("lancamento dividido diz em quantas partes e nao mostra categoria", () => {
  renderTable([makeTransaction({ title: "Compras" }, [{ description: "a", category_id: "c1" }, { description: "b" }])]);
  const cells = within(rows()[0]).getAllByRole("cell");
  expect(cells[1].textContent).toBe("Compras");
  expect(cells[2].textContent).toBe("Dividida em 2");
  expect(cells[4].textContent).toBe("");
});

it("marca conferido e conciliado", () => {
  renderTable([tx("Conferida", [{ cleared: true }]), tx("Travada", [{ cleared: true, locked: true }]), tx("Normal")]);
  expect(within(rowOf(/Conferida/)).getByText("Conferido")).toBeInTheDocument();
  expect(within(rowOf(/Travada/)).getByText("Conciliado")).toBeInTheDocument();
  expect(within(rowOf(/Normal/)).queryByText(/Conferido|Conciliado/)).not.toBeInTheDocument();
});

// ---------- Teclado entre as linhas ----------

it("so uma linha tem parada de Tab", () => {
  renderTable([tx("A"), tx("B"), tx("C")]);
  expect(rows().map((row) => row.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
});

it("as setas e J e K andam entre as linhas, sem dar a volta", async () => {
  renderTable([tx("A"), tx("B"), tx("C")]);
  rowOf(/^A/).focus();
  await user.keyboard("{ArrowDown}");
  expect(rowOf(/^B/)).toHaveFocus();
  await user.keyboard("j");
  expect(rowOf(/^C/)).toHaveFocus();
  await user.keyboard("j");
  expect(rowOf(/^C/)).toHaveFocus();
  await user.keyboard("k");
  expect(rowOf(/^B/)).toHaveFocus();
  await user.keyboard("{ArrowUp}{ArrowUp}");
  expect(rowOf(/^A/)).toHaveFocus();
});

it("Home e End vao para as pontas", async () => {
  renderTable([tx("A"), tx("B"), tx("C")]);
  rowOf(/^A/).focus();
  await user.keyboard("{End}");
  expect(rowOf(/^C/)).toHaveFocus();
  await user.keyboard("{Home}");
  expect(rowOf(/^A/)).toHaveFocus();
});

it("a parada de Tab acompanha a linha em que o foco esteve", async () => {
  renderTable([tx("A"), tx("B"), tx("C")]);
  rowOf(/^A/).focus();
  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(rows().map((row) => row.getAttribute("tabindex"))).toEqual(["-1", "-1", "0"]);
});

it("letras com Ctrl ou outras teclas nao fazem nada", async () => {
  renderTable([tx("A"), tx("B")]);
  rowOf(/^A/).focus();
  await user.keyboard("{Control>}j{/Control}x");
  expect(rowOf(/^A/)).toHaveFocus();
  expect(screen.queryByRole("row", { name: "Novo lançamento" })).not.toBeInTheDocument();
});

it("a tecla apertada dentro de um botao da linha e do botao, nao da tabela", async () => {
  renderTable([tx("A"), tx("B")]);
  const edit = screen.getByRole("button", { name: "Editar A" });
  edit.focus();
  await user.keyboard("j");
  await user.keyboard("t");
  expect(edit).toHaveFocus();
  expect(screen.queryByRole("row", { name: "Novo lançamento" })).not.toBeInTheDocument();
});

it("com a lista menor, a parada de Tab continua dentro dela", () => {
  const props = { categories, accounts: [nubank], onOpen: vi.fn(), onRemove: vi.fn() };
  const client = newTestQueryClient();
  server.use(...fakeAccountsApi([nubank]).handlers);
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <TransactionsTable items={[tx("A"), tx("B"), tx("C")]} {...props} />
    </QueryClientProvider>,
  );
  rerender(
    <QueryClientProvider client={client}>
      <TransactionsTable items={[tx("A")]} {...props} />
    </QueryClientProvider>,
  );
  expect(rows().map((row) => row.getAttribute("tabindex"))).toEqual(["0"]);
});

// ---------- Linha de entrada ----------

it("T abre a linha de entrada no topo, com a data de hoje, a conta padrao e o foco na data", async () => {
  renderTable([tx("A")]);
  rowOf(/^A/).focus();
  await user.keyboard("t");
  const entry = newRow();
  expect(screen.getAllByRole("row")[1]).toBe(entry);
  expect(field("Data")).toHaveFocus();
  expect(field("Data")).toHaveValue(appToday());
  expect(field("Conta")).toHaveValue("a1");
});

it("o botao Nova linha faz o mesmo", async () => {
  renderTable([tx("A")]);
  await openNewRow();
  expect(field("Data")).toHaveFocus();
});

it("o Tab anda pelos campos na ordem das colunas", async () => {
  renderTable([tx("A")]);
  await openNewRow();
  const order: string[] = [];
  for (let step = 0; step < 6; step += 1) {
    order.push((document.activeElement as HTMLElement).getAttribute("aria-label") ?? "");
    await user.tab();
  }
  expect(order).toEqual(["Data", "Descrição", "Contraparte", "Conta", "Categoria", "Valor"]);
});

it("mostra se o valor digitado e saida ou entrada", async () => {
  renderTable([tx("A")]);
  await openNewRow();
  await user.type(field("Valor"), "-5");
  expect(screen.getByText("Saída")).toBeVisible();
  await user.clear(field("Valor"));
  await user.type(field("Valor"), "5");
  expect(screen.getByText("Entrada")).toBeVisible();
});

it("Enter com campos faltando mostra os erros, foca o primeiro e nao chama o servidor", async () => {
  const { api } = renderTable([tx("A")]);
  await openNewRow();
  await user.keyboard("{Enter}");
  // Linha em branco: nao faz nada
  expect(api.state.writes).toHaveLength(0);
  await user.type(field("Descrição"), "Padaria");
  await user.keyboard("{Enter}");
  expect(await screen.findByText("Informe a contraparte.")).toBeVisible();
  expect(screen.getByText("Informe o valor.")).toBeVisible();
  expect(field("Contraparte")).toHaveFocus();
  expect(field("Contraparte")).toHaveAttribute("aria-invalid", "true");
  expect(api.state.writes).toHaveLength(0);
});

it("o erro some quando o campo e corrigido", async () => {
  renderTable([tx("A")]);
  await openNewRow();
  await user.type(field("Descrição"), "Padaria");
  await user.keyboard("{Enter}");
  await screen.findByText("Informe a contraparte.");
  await user.type(field("Contraparte"), "Z");
  expect(screen.queryByText("Informe a contraparte.")).not.toBeInTheDocument();
});

it("Enter grava a linha e deixa uma nova aberta, na mesma data e conta, com o foco na descricao", async () => {
  const { api } = renderTable([tx("A")]);
  await openNewRow();
  await user.selectOptions(field("Conta"), "Poupanca");
  await user.selectOptions(field("Categoria"), "Mercado");
  await fillNewRow();
  await user.keyboard("{Enter}");

  await waitFor(() => expect(api.state.writes).toHaveLength(1));
  expect(api.state.writes[0]).toMatchObject({
    method: "POST",
    body: {
      splits: [
        {
          type: "withdrawal",
          date: appToday(),
          account_id: "a2",
          description: "Padaria",
          counterparty_name: "Padaria do Ze",
          amount: "12.50",
          category_id: "c1",
        },
      ],
    },
  });
  await waitFor(() => expect(field("Descrição")).toHaveValue(""));
  expect(field("Descrição")).toHaveFocus();
  expect(field("Conta")).toHaveValue("a2");
  expect(field("Data")).toHaveValue(appToday());
  expect(field("Contraparte")).toHaveValue("");
  expect(field("Valor")).toHaveValue("");
});

it("valor sem sinal grava uma entrada", async () => {
  const { api } = renderTable([tx("A")]);
  await openNewRow();
  await fillNewRow({ description: "Salario", counterparty: "Empresa", amount: "1.000,00" });
  await user.keyboard("{Enter}");
  await waitFor(() => expect(api.state.writes).toHaveLength(1));
  expect(api.state.writes[0].body.splits[0]).toMatchObject({ type: "deposit", amount: "1000.00" });
});

it("Ctrl+Enter grava e fecha a linha, devolvendo o foco ao botao Nova linha", async () => {
  const { api } = renderTable([tx("A")]);
  await openNewRow();
  await fillNewRow();
  await user.keyboard("{Control>}{Enter}{/Control}");
  await waitFor(() => expect(api.state.writes).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole("row", { name: "Novo lançamento" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Nova linha" })).toHaveFocus();
});

it("Ctrl+Enter numa linha em branco so fecha", async () => {
  const { api } = renderTable([tx("A")]);
  await openNewRow();
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(screen.queryByRole("row", { name: "Novo lançamento" })).not.toBeInTheDocument();
  expect(api.state.writes).toHaveLength(0);
});

it("Esc cancela a linha nova sem gravar nada", async () => {
  const { api } = renderTable([tx("A")]);
  await openNewRow();
  await fillNewRow();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("row", { name: "Novo lançamento" })).not.toBeInTheDocument();
  expect(api.state.writes).toHaveLength(0);
});

it("o botao Adicionar grava como o Enter", async () => {
  const { api } = renderTable([tx("A")]);
  await openNewRow();
  await fillNewRow();
  await user.click(screen.getByRole("button", { name: "Adicionar" }));
  await waitFor(() => expect(api.state.writes).toHaveLength(1));
});

it("o erro do servidor aparece embaixo e a linha continua aberta com o que foi digitado", async () => {
  const { api } = renderTable([tx("A")]);
  await openNewRow();
  await fillNewRow();
  api.state.nextWriteError = { status: 409, code: "transaction_locked" };
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent(/travado por uma conciliação/);
  expect(field("Descrição")).toHaveValue("Padaria");
  expect(field("Valor")).not.toBeDisabled();
});

it("sugere contrapartes ja usadas", async () => {
  const { api } = renderTable([tx("A")]);
  api.state.counterparties = [
    { id: "p1", name: "Mercado Central", type: "expense" },
    { id: "p2", name: "Salario", type: "revenue" },
  ];
  await openNewRow();
  await user.type(field("Valor"), "-1");
  await user.type(field("Contraparte"), "Merc");
  await waitFor(() => {
    const options = [...document.querySelectorAll("datalist option")].map((option) => option.getAttribute("value"));
    expect(options).toEqual(["Mercado Central"]);
  });
});

// ---------- Edicao na linha ----------

it("Enter abre a edicao na propria linha com os valores atuais", async () => {
  renderTable([tx("Mercado", [{ amount: "50.00", category_id: "c1", destination_account_name: "Supermercado" }])]);
  rowOf(/^Mercado/).focus();
  await user.keyboard("{Enter}");
  expect(field("Descrição")).toHaveFocus();
  expect(field("Descrição")).toHaveValue("Mercado");
  expect(field("Contraparte")).toHaveValue("Supermercado");
  expect(field("Conta")).toHaveValue("a1");
  expect(field("Categoria")).toHaveValue("c1");
  expect(field("Valor")).toHaveValue("-50,00");
  expect(screen.getByText("Saída")).toBeVisible();
});

it("salvar mantem o que a linha nao mostra (tags, nota, orcamento) e desce o foco", async () => {
  const items = [
    tx("Mercado", [{ amount: "50.00", tag_ids: ["t1"], notes: "nota", budget_id: "b1", destination_account_name: "Supermercado" }]),
    tx("Padaria"),
  ];
  const { api } = renderTable(items);
  rowOf(/^Mercado/).focus();
  await user.keyboard("{Enter}");
  await user.clear(field("Descrição"));
  await user.type(field("Descrição"), "Mercado do mes");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(api.state.writes).toHaveLength(1));
  expect(api.state.writes[0]).toMatchObject({
    method: "PUT",
    id: items[0].id,
    body: { splits: [{ type: "withdrawal", description: "Mercado do mes", amount: "50.00", tag_ids: ["t1"], notes: "nota", budget_id: "b1" }] },
  });
  await waitFor(() => expect(rowOf(/^Padaria/)).toHaveFocus());
});

it("trocar o sinal do valor muda o tipo do lancamento", async () => {
  const { api } = renderTable([tx("Reembolso", [{ amount: "50.00" }])]);
  rowOf(/^Reembolso/).focus();
  await user.keyboard("{Enter}");
  await user.clear(field("Valor"));
  await user.type(field("Valor"), "50,00");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(api.state.writes).toHaveLength(1));
  expect(api.state.writes[0].body.splits[0]).toMatchObject({ type: "deposit", amount: "50.00", budget_id: null });
});

it("Enter sem mudar nada fecha a edicao sem pedir nada ao servidor", async () => {
  const { api } = renderTable([tx("Mercado"), tx("Padaria")]);
  rowOf(/^Mercado/).focus();
  await user.keyboard("{Enter}");
  await user.keyboard("{Enter}");
  expect(api.state.writes).toHaveLength(0);
  expect(screen.queryByRole("row", { name: /^Editando/ })).not.toBeInTheDocument();
  await waitFor(() => expect(rowOf(/^Padaria/)).toHaveFocus());
});

it("Esc cancela a edicao, descarta o que foi digitado e volta o foco para a mesma linha", async () => {
  const { api } = renderTable([tx("Mercado"), tx("Padaria")]);
  rowOf(/^Mercado/).focus();
  await user.keyboard("{Enter}");
  await user.type(field("Descrição"), " alterado");
  await user.keyboard("{Escape}");
  expect(api.state.writes).toHaveLength(0);
  await waitFor(() => expect(rowOf(/^Mercado/)).toHaveFocus());
  expect(rowOf(/^Mercado/)).toBeInTheDocument();
});

it("o lapis edita na linha e Editar completo abre o formulario", async () => {
  const items = [tx("Mercado")];
  const { onOpen } = renderTable(items);
  await user.click(screen.getByRole("button", { name: "Editar completo Mercado" }));
  expect(onOpen).toHaveBeenCalledWith(items[0]);
  await user.click(screen.getByRole("button", { name: "Editar Mercado" }));
  expect(screen.getByRole("row", { name: "Editando Mercado" })).toBeInTheDocument();
  expect(onOpen).toHaveBeenCalledTimes(1);
});

it.each([
  ["dividido", () => makeTransaction({ title: "Compras" }, [{ description: "a", source_account_id: "a1" }, { description: "b", source_account_id: "a1" }])],
  ["transferencia", () => makeTransaction({}, [transfer({ description: "Reserva", source_account_id: "a1", destination_account_id: "a2" })])],
])("lancamento %s abre o formulario completo em vez de editar na linha", async (_name, build) => {
  const item = build();
  const { onOpen } = renderTable([item]);
  rows()[0].focus();
  await user.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith(item);
  expect(screen.queryByRole("row", { name: /^Editando/ })).not.toBeInTheDocument();
});

it("o erro do servidor na edicao (lancamento travado) fica na linha", async () => {
  const { api } = renderTable([tx("Mercado", [{ cleared: true, locked: true }])]);
  rowOf(/^Mercado/).focus();
  await user.keyboard("{Enter}");
  await user.type(field("Descrição"), "x");
  api.state.nextWriteError = { status: 409, code: "transaction_locked" };
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent(/travado por uma conciliação/);
  expect(screen.getByRole("row", { name: "Editando Mercado" })).toBeInTheDocument();
});

it("abrir outra linha para editar fecha a anterior", async () => {
  renderTable([tx("Mercado"), tx("Padaria")]);
  rowOf(/^Mercado/).focus();
  await user.keyboard("{Enter}");
  await user.click(screen.getByRole("button", { name: "Editar Padaria" }));
  expect(screen.queryByRole("row", { name: "Editando Mercado" })).not.toBeInTheDocument();
  expect(screen.getByRole("row", { name: "Editando Padaria" })).toBeInTheDocument();
});

it("a linha nova e a edicao nao ficam abertas juntas", async () => {
  renderTable([tx("Mercado")]);
  await openNewRow();
  await user.click(screen.getByRole("button", { name: "Editar Mercado" }));
  expect(screen.queryByRole("row", { name: "Novo lançamento" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Nova linha" }));
  expect(screen.queryByRole("row", { name: /^Editando/ })).not.toBeInTheDocument();
});

// ---------- Atalhos ----------

it("o botao Atalhos mostra as teclas e fecha", async () => {
  renderTable([tx("A")]);
  await user.click(screen.getByRole("button", { name: "Atalhos" }));
  const dialog = await screen.findByRole("dialog", { name: "Atalhos da tabela" });
  expect(within(dialog).getByRole("region", { name: "Com o foco numa linha da tabela" })).toHaveTextContent("Nova linha de lançamento");
  expect(within(dialog).getByRole("region", { name: "Na linha de entrada ou de edição" })).toHaveTextContent("Gravar e fechar a linha nova");
  await user.click(within(dialog).getAllByRole("button", { name: "Fechar" }).at(-1) as HTMLElement);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("Esc fecha o dialogo dos atalhos e nao mexe na tabela", async () => {
  renderTable([tx("A")]);
  await user.click(screen.getByRole("button", { name: "Atalhos" }));
  await screen.findByRole("dialog");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("row", { name: "Novo lançamento" })).not.toBeInTheDocument();
});

// ---------- Casos de borda (cobrem o que a mutacao apontou) ----------

it("sugere receitas quando o valor e uma entrada", async () => {
  const { api } = renderTable([tx("A")]);
  api.state.counterparties = [
    { id: "p1", name: "Mercado Central", type: "expense" },
    { id: "p2", name: "Mercado Livre", type: "revenue" },
  ];
  await openNewRow();
  await user.type(field("Valor"), "10");
  await user.type(field("Contraparte"), "Merc");
  await waitFor(() => {
    const options = [...document.querySelectorAll("datalist option")].map((option) => option.getAttribute("value"));
    expect(options).toEqual(["Mercado Livre"]);
  });
});

it("editar um lancamento de conta arquivada mantem a conta na escolha", async () => {
  const velha = makeAccount({ id: "a9", name: "Conta velha", active: false });
  const items = [tx("Antigo", [{ source_account_id: "a9", source_account_name: "Conta velha" }])];
  const api = fakeTransactionsApi(items, [nubank, velha]);
  server.use(...api.handlers, ...fakeAccountsApi([nubank, velha]).handlers);
  render(
    <QueryClientProvider client={newTestQueryClient()}>
      <TransactionsTable items={items} categories={categories} accounts={[nubank, velha]} onOpen={vi.fn()} onRemove={vi.fn()} />
    </QueryClientProvider>,
  );
  rowOf(/^Antigo/).focus();
  await user.keyboard("{Enter}");
  const select = field("Conta") as HTMLSelectElement;
  expect(select).toHaveValue("a9");
  expect([...select.options].map((option) => option.text)).toEqual(["Escolha", "Nubank", "Conta velha (arquivada)"]);
});

it("uma conta arquivada nao aparece na linha nova", async () => {
  const velha = makeAccount({ id: "a9", name: "Conta velha", active: false });
  const api = fakeTransactionsApi([tx("A")], [nubank, velha]);
  server.use(...api.handlers, ...fakeAccountsApi([nubank, velha]).handlers);
  render(
    <QueryClientProvider client={newTestQueryClient()}>
      <TransactionsTable items={[tx("A")]} categories={categories} accounts={[nubank, velha]} onOpen={vi.fn()} onRemove={vi.fn()} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Nova linha" }));
  expect([...(field("Conta") as HTMLSelectElement).options].map((option) => option.text)).toEqual(["Escolha", "Nubank"]);
});
