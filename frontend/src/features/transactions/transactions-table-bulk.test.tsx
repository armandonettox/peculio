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
import { makeTransaction } from "@/test-utils/transaction-fixtures";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import { TransactionsTable } from "./transactions-table";

const mercado = makeLabel({ id: "c1", name: "Mercado" }) as Category;
const lazer = makeLabel({ id: "c2", name: "Lazer" }) as Category;
const categories = new Map([
  [mercado.id, mercado],
  [lazer.id, lazer],
]);
const nubank = makeAccount({ id: "a1", name: "Nubank" });
const user = userEvent.setup();

const tx = (description: string) => makeTransaction({}, [{ description, source_account_id: "a1" }]);

function renderTable(items: Transaction[], total = items.length) {
  const api = fakeTransactionsApi(items, [nubank]);
  server.use(...api.handlers, ...fakeAccountsApi([nubank]).handlers);
  const handlers = { onOpen: vi.fn(), onRemove: vi.fn() };
  const view = render(
    <QueryClientProvider client={newTestQueryClient()}>
      <TransactionsTable items={items} total={total} categories={categories} accounts={[nubank]} {...handlers} />
    </QueryClientProvider>,
  );
  return { ...handlers, api, view };
}

const rowOf = (name: RegExp) => screen.getByRole("row", { name });
const check = (title: string) => screen.getByRole("checkbox", { name: `Selecionar ${title}` }) as HTMLInputElement;
const bar = () => screen.queryByRole("region", { name: "Ações em massa" });
const summary = () => within(screen.getByRole("region", { name: "Ações em massa" })).getByRole("status").textContent;
const dialog = () => screen.getByRole("dialog");

const five = () => ["A", "B", "C", "D", "E"].map(tx);

// ---------- Marcar ----------

it("Espaco marca a linha e mostra a barra; de novo desmarca e a barra some", async () => {
  renderTable(five());
  expect(bar()).not.toBeInTheDocument();
  rowOf(/^A/).focus();
  await user.keyboard(" ");
  expect(check("A")).toBeChecked();
  expect(summary()).toBe("1 selecionado");
  await user.keyboard(" ");
  expect(check("A")).not.toBeChecked();
  expect(bar()).not.toBeInTheDocument();
});

it("marcar pelo mouse e pelo teclado dao no mesmo", async () => {
  renderTable(five());
  await user.click(check("B"));
  rowOf(/^C/).focus();
  await user.keyboard(" ");
  expect(summary()).toBe("2 selecionados");
  expect(rowOf(/^B/)).toHaveClass("bg-accent/40");
});

it("Shift+Espaco marca do ultimo marcado ate a linha", async () => {
  renderTable(five());
  rowOf(/^A/).focus();
  await user.keyboard(" ");
  await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
  await user.keyboard("{Shift>} {/Shift}");
  expect(summary()).toBe("4 selecionados");
  expect(check("E")).not.toBeChecked();
  for (const title of ["A", "B", "C", "D"]) expect(check(title)).toBeChecked();
});

it("Shift mais clique no quadradinho marca o intervalo", async () => {
  renderTable(five());
  await user.click(check("B"));
  await user.keyboard("{Shift>}");
  await user.click(check("D"));
  await user.keyboard("{/Shift}");
  expect(summary()).toBe("3 selecionados");
  expect(check("C")).toBeChecked();
});

it("Ctrl+A marca todos os carregados e, de novo, desmarca; Esc limpa", async () => {
  renderTable(five());
  rowOf(/^A/).focus();
  await user.keyboard("{Control>}a{/Control}");
  expect(summary()).toBe("5 selecionados");
  await user.keyboard("{Control>}a{/Control}");
  expect(bar()).not.toBeInTheDocument();

  await user.keyboard("{Control>}a{/Control}");
  expect(summary()).toBe("5 selecionados");
  await user.keyboard("{Escape}");
  expect(bar()).not.toBeInTheDocument();
});

it("o quadradinho do cabecalho marca todos, fica indeterminado com alguns e desmarca", async () => {
  renderTable(five());
  const all = screen.getByRole("checkbox", { name: "Selecionar todos os carregados" }) as HTMLInputElement;
  await user.click(check("A"));
  expect(all.indeterminate).toBe(true);
  expect(all).not.toBeChecked();
  await user.click(all);
  expect(summary()).toBe("5 selecionados");
  expect(all).toBeChecked();
  expect(all.indeterminate).toBe(false);
  await user.click(all);
  expect(bar()).not.toBeInTheDocument();
});

it("avisa que a selecao so pega o que esta carregado", async () => {
  renderTable(five(), 25);
  rowOf(/^A/).focus();
  await user.keyboard("{Control>}a{/Control}");
  expect(summary()).toBe("5 selecionados (só os 5 carregados; há mais 20 por carregar)");
});

it("Limpar selecao desmarca tudo", async () => {
  renderTable(five());
  await user.click(check("A"));
  await user.click(screen.getByRole("button", { name: "Limpar seleção" }));
  expect(bar()).not.toBeInTheDocument();
});

it("o que sai da lista sai da selecao", async () => {
  const items = five();
  const { view } = renderTable(items);
  await user.click(check("A"));
  await user.click(check("B"));
  expect(summary()).toBe("2 selecionados");
  view.rerender(
    <QueryClientProvider client={newTestQueryClient()}>
      <TransactionsTable items={items.slice(1)} total={4} categories={categories} accounts={[nubank]} onOpen={vi.fn()} onRemove={vi.fn()} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(summary()).toBe("1 selecionado"));
});

// ---------- Mudar categoria ----------

it("mudar categoria pede a escolha, manda os ids na ordem da lista e limpa a selecao", async () => {
  const items = five();
  const { api } = renderTable(items);
  await user.click(check("C"));
  await user.click(check("A"));
  await user.click(screen.getByRole("button", { name: "Mudar categoria" }));

  await user.click(within(dialog()).getByRole("button", { name: "Mudar categoria" }));
  expect(await within(dialog()).findByText(/Escolha uma categoria/)).toBeVisible();
  expect(api.state.bulks).toHaveLength(0);

  await user.selectOptions(within(dialog()).getByLabelText("Categoria"), "Mercado");
  await user.click(within(dialog()).getByRole("button", { name: "Mudar categoria" }));

  await waitFor(() => expect(api.state.bulks).toHaveLength(1));
  expect(api.state.bulks[0]).toEqual({ ids: [items[0].id, items[2].id], action: "set_category", category_id: "c1" });
  expect(await screen.findByText("Categoria mudada em 2 lançamentos.")).toBeVisible();
  expect(bar()).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("Sem categoria tira a categoria", async () => {
  const { api } = renderTable(five());
  await user.click(check("A"));
  await user.click(screen.getByRole("button", { name: "Mudar categoria" }));
  await user.selectOptions(within(dialog()).getByLabelText("Categoria"), "Sem categoria (tirar a categoria)");
  await user.click(within(dialog()).getByRole("button", { name: "Mudar categoria" }));
  await waitFor(() => expect(api.state.bulks).toHaveLength(1));
  expect(api.state.bulks[0]).toMatchObject({ action: "set_category", category_id: null });
  expect(await screen.findByText("Categoria removida de 1 lançamento.")).toBeVisible();
});

// ---------- Mudar data ----------

it("mudar data manda a data escolhida", async () => {
  const items = five();
  const { api } = renderTable(items);
  await user.click(check("B"));
  await user.click(check("D"));
  await user.click(screen.getByRole("button", { name: "Mudar data" }));
  const date = within(dialog()).getByLabelText("Data");
  // Comeca em hoje
  expect(date).toHaveValue(appToday());
  await user.clear(date);
  await user.type(date, "2026-02-01");
  await user.click(within(dialog()).getByRole("button", { name: "Mudar data" }));
  await waitFor(() => expect(api.state.bulks).toHaveLength(1));
  expect(api.state.bulks[0]).toEqual({ ids: [items[1].id, items[3].id], action: "set_date", date: "2026-02-01" });
  expect(await screen.findByText("Data mudada em 2 lançamentos.")).toBeVisible();
});

it("mudar data sem data nao chama o servidor", async () => {
  const { api } = renderTable(five());
  await user.click(check("B"));
  await user.click(screen.getByRole("button", { name: "Mudar data" }));
  await user.clear(within(dialog()).getByLabelText("Data"));
  await user.click(within(dialog()).getByRole("button", { name: "Mudar data" }));
  expect(await within(dialog()).findByText("Informe uma data válida.")).toBeVisible();
  expect(api.state.bulks).toHaveLength(0);
});

// ---------- Duplicar e excluir ----------

it("duplicar age na hora e avisa que a data e a de hoje", async () => {
  const items = five();
  const { api } = renderTable(items);
  await user.click(check("A"));
  await user.click(check("B"));
  await user.click(screen.getByRole("button", { name: "Duplicar" }));
  await waitFor(() => expect(api.state.bulks).toHaveLength(1));
  expect(api.state.bulks[0]).toEqual({ ids: [items[0].id, items[1].id], action: "duplicate" });
  expect(await screen.findByText("2 lançamentos duplicados com a data de hoje.")).toBeVisible();
  expect(bar()).not.toBeInTheDocument();
});

it("excluir pede confirmacao com a contagem; cancelar nao exclui", async () => {
  const items = five();
  const { api } = renderTable(items);
  await user.click(check("A"));
  await user.click(check("C"));
  await user.click(check("E"));
  await user.click(within(screen.getByRole("region", { name: "Ações em massa" })).getByRole("button", { name: "Excluir" }));
  expect(dialog()).toHaveTextContent("3 lançamentos");
  await user.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
  expect(api.state.bulks).toHaveLength(0);
  expect(summary()).toBe("3 selecionados");

  await user.click(within(screen.getByRole("region", { name: "Ações em massa" })).getByRole("button", { name: "Excluir" }));
  await user.click(within(dialog()).getByRole("button", { name: "Excluir" }));
  await waitFor(() => expect(api.state.bulks).toHaveLength(1));
  expect(api.state.bulks[0]).toEqual({ ids: [items[0].id, items[2].id, items[4].id], action: "delete" });
  expect(await screen.findByText("3 lançamentos excluídos.")).toBeVisible();
});

// ---------- Recusas ----------

it("travados barram a acao inteira, aparecem pelo nome e podem ser desmarcados", async () => {
  const items = five();
  const { api } = renderTable(items);
  api.state.lockedIds = [items[1].id];
  await user.click(check("A"));
  await user.click(check("B"));
  await user.click(screen.getByRole("button", { name: "Duplicar" }));
  // Duplicar nao mexe nos originais: travado nao atrapalha
  await screen.findByText("2 lançamentos duplicados com a data de hoje.");

  await user.click(check("A"));
  await user.click(check("B"));
  await user.click(screen.getByRole("button", { name: "Mudar data" }));
  await user.click(within(dialog()).getByRole("button", { name: "Mudar data" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Alguns lançamentos estão travados por uma conciliação fechada. Nada foi alterado.");
  expect(alert).toHaveTextContent("Travados: B.");
  expect(summary()).toBe("2 selecionados");

  await user.click(screen.getByRole("button", { name: "Desmarcar os travados" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(summary()).toBe("1 selecionado");
  expect(check("B")).not.toBeChecked();
  expect(check("A")).toBeChecked();
});

it("a lista de travados corta em cinco", async () => {
  const items = ["A", "B", "C", "D", "E", "F", "G"].map(tx);
  const { api } = renderTable(items);
  api.state.lockedIds = items.map((item) => item.id);
  rowOf(/^A/).focus();
  await user.keyboard("{Control>}a{/Control}");
  await user.click(screen.getByRole("button", { name: "Mudar data" }));
  await user.click(within(dialog()).getByRole("button", { name: "Mudar data" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Travados: A, B, C, D, E e mais 2.");
});

it("erro do servidor aparece e a selecao fica para tentar de novo", async () => {
  const { api } = renderTable(five());
  await user.click(check("A"));
  api.state.nextWriteError = { status: 500, code: "internal_error" };
  await user.click(screen.getByRole("button", { name: "Duplicar" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Desmarcar os travados" })).not.toBeInTheDocument();
  expect(summary()).toBe("1 selecionado");
});

it("passou de 200 marcados: avisa e desabilita as acoes", async () => {
  const items = Array.from({ length: 201 }, (_, index) => tx(`T${index}`));
  renderTable(items);
  rowOf(/^T0,/).focus();
  await user.keyboard("{Control>}a{/Control}");
  expect(await screen.findByText("Selecione no máximo 200 lançamentos por vez (há 201 marcados).")).toBeVisible();
  for (const name of ["Mudar categoria", "Mudar data", "Duplicar", "Excluir"]) {
    expect(within(screen.getByRole("region", { name: "Ações em massa" })).getByRole("button", { name })).toBeDisabled();
  }
  expect(screen.getByRole("button", { name: "Limpar seleção" })).toBeEnabled();
  // 201 linhas pesam: com a maquina ocupada o tempo padrao nao basta
}, 40_000);

it("o aviso de sucesso some na proxima acao", async () => {
  const { api } = renderTable(five());
  await user.click(check("A"));
  await user.click(screen.getByRole("button", { name: "Duplicar" }));
  await screen.findByText("1 lançamento duplicado com a data de hoje.");
  await user.click(check("B"));
  api.state.nextWriteError = { status: 500, code: "internal_error" };
  await user.click(screen.getByRole("button", { name: "Duplicar" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("1 lançamento duplicado com a data de hoje.")).not.toBeInTheDocument();
});

it("o botao Atalhos tambem lista as teclas da selecao", async () => {
  renderTable(five());
  await user.click(screen.getByRole("button", { name: "Atalhos" }));
  const region = within(await screen.findByRole("dialog")).getByRole("region", { name: "Selecionar vários lançamentos" });
  expect(region).toHaveTextContent("Marcar do último marcado até a linha");
  expect(region).toHaveTextContent("Ctrl+A");
});
