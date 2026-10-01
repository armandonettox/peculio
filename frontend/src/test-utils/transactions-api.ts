import { http, HttpResponse } from "msw";

import type { Account } from "@/api/accounts";
import type { Transaction, TransactionCreate } from "@/api/transactions";
import { transactionDate } from "@/features/transactions/presentation";
import { makeSplit, makeTransaction } from "./transaction-fixtures";

function matches(transaction: Transaction, query: URLSearchParams): boolean {
  const q = (query.get("q") ?? "").toLowerCase();
  const account = query.get("account_id");
  const category = query.get("category_id");
  const tag = query.get("tag_id");
  const from = query.get("date_from");
  const to = query.get("date_to");
  const min = query.get("min_amount");
  const max = query.get("max_amount");

  // Como no backend: o grupo entra se algum split atende a todos os filtros ao mesmo tempo
  return transaction.splits.some(
    (split) =>
      (!account || split.source_account_id === account || split.destination_account_id === account) &&
      (!category || split.category_id === category) &&
      (!tag || split.tag_ids.includes(tag)) &&
      (!from || split.date >= from) &&
      (!to || split.date <= to) &&
      (!min || Number(split.amount) >= Number(min)) &&
      (!max || Number(split.amount) <= Number(max)) &&
      (!q || split.description.toLowerCase().includes(q) || (transaction.title ?? "").toLowerCase().includes(q)),
  );
}

/**
 * API de transacoes de mentira: filtra, ordena (data do lancamento, mais recente primeiro) e
 * pagina como o backend, e guarda os parametros de cada chamada para o teste conferir.
 */
export function fakeTransactionsApi(initial: Transaction[] = [], accounts: Account[] = []) {
  const state = {
    items: [...initial],
    requests: [] as URLSearchParams[],
    // Corpos recebidos em POST e PUT, e erro devolvido na proxima gravacao
    writes: [] as { method: "POST" | "PUT"; id?: string; body: TransactionCreate }[],
    removed: [] as string[],
    nextWriteError: null as { status: number; code: string } | null,
    counterparties: [] as { id: string; name: string; type: string }[],
    counterpartyRequests: [] as URLSearchParams[],
    listError: false,
    // Falha uma vez a pagina que comeca neste offset (para testar "Carregar mais" com erro)
    failOffsetOnce: null as number | null,
  };

  const handler = http.get("*/api/v1/transactions", ({ request }) => {
    const query = new URL(request.url).searchParams;
    state.requests.push(query);

    const offset = Number(query.get("offset") ?? 0);
    const limit = Number(query.get("limit") ?? 50);
    if (state.listError || state.failOffsetOnce === offset) {
      state.failOffsetOnce = null;
      return HttpResponse.json({ detail: "erro", code: "internal_error" }, { status: 500 });
    }

    const filtered = state.items.filter((transaction) => matches(transaction, query));
    filtered.sort((a, b) => {
      const byDate = transactionDate(b).localeCompare(transactionDate(a));
      return byDate || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);
    });
    return HttpResponse.json({
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    });
  });

  // Monta o lancamento salvo a partir do corpo, com os nomes das contas conhecidas
  const toTransaction = (body: TransactionCreate, id?: string): Transaction => {
    const name = (accountId: string | null | undefined, fallback: string) =>
      accounts.find((account) => account.id === accountId)?.name ?? fallback;
    const type = (accountId: string | null | undefined) => accounts.find((a) => a.id === accountId)?.type;
    const splits = body.splits.map((split) => {
      const own = name(split.account_id, "Conta");
      const ownType = type(split.account_id) ?? "asset";
      const otherName = name(split.counterparty_account_id, split.counterparty_name ?? "Contraparte");
      const otherType =
        type(split.counterparty_account_id) ?? (split.type === "withdrawal" ? "expense" : "revenue");
      const outgoing = split.type !== "deposit";
      return makeSplit({
        type: split.type,
        date: split.date,
        description: split.description,
        amount: String(split.amount),
        currency_code: split.currency_code,
        foreign_amount: split.foreign_amount == null ? null : String(split.foreign_amount),
        foreign_currency_code: split.foreign_currency_code ?? null,
        category_id: split.category_id ?? null,
        budget_id: split.budget_id ?? null,
        tag_ids: split.tag_ids ?? [],
        notes: split.notes ?? null,
        source_account_id: outgoing ? split.account_id : (split.counterparty_account_id ?? "externo"),
        source_account_name: outgoing ? own : otherName,
        source_account_type: (outgoing ? ownType : otherType) as Transaction["splits"][number]["source_account_type"],
        destination_account_id: outgoing ? (split.counterparty_account_id ?? "externo") : split.account_id,
        destination_account_name: outgoing ? otherName : own,
        destination_account_type: (outgoing ? otherType : ownType) as Transaction["splits"][number]["destination_account_type"],
      });
    });
    return { ...makeTransaction({ ...(id ? { id } : {}), title: body.title ?? null }), splits };
  };

  const failWrite = () => {
    const error = state.nextWriteError;
    state.nextWriteError = null;
    return error ? HttpResponse.json({ detail: "erro", code: error.code }, { status: error.status }) : null;
  };

  const writeHandlers = [
    http.post("*/api/v1/transactions", async ({ request }) => {
      const body = (await request.json()) as TransactionCreate;
      state.writes.push({ method: "POST", body });
      const error = failWrite();
      if (error) return error;
      const created = toTransaction(body);
      state.items.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.put("*/api/v1/transactions/:id", async ({ request, params }) => {
      const body = (await request.json()) as TransactionCreate;
      state.writes.push({ method: "PUT", id: String(params.id), body });
      const error = failWrite();
      if (error) return error;
      const saved = toTransaction(body, String(params.id));
      state.items = state.items.map((item) => (item.id === params.id ? saved : item));
      return HttpResponse.json(saved);
    }),
    http.delete("*/api/v1/transactions/:id", ({ params }) => {
      state.removed.push(String(params.id));
      const error = failWrite();
      if (error) return error;
      state.items = state.items.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get("*/api/v1/transactions/counterparties",({ request }) => {
      const query = new URL(request.url).searchParams;
      state.counterpartyRequests.push(query);
      const type = query.get("type");
      const q = (query.get("q") ?? "").toLowerCase();
      return HttpResponse.json(
        state.counterparties.filter((item) => item.type === type && item.name.toLowerCase().includes(q)),
      );
    }),
  ];

  const params = (index = -1) => Object.fromEntries((state.requests.at(index) ?? new URLSearchParams()).entries());
  const withParam = (name: string) => state.requests.filter((request) => request.has(name));
  return { handler, handlers: [handler, ...writeHandlers], state, params, withParam };
}
