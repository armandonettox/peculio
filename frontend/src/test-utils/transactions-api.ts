import { http, HttpResponse } from "msw";

import type { Transaction } from "@/api/transactions";
import { transactionDate } from "@/features/transactions/presentation";

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
export function fakeTransactionsApi(initial: Transaction[] = []) {
  const state = {
    items: [...initial],
    requests: [] as URLSearchParams[],
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

  const params = (index = -1) => Object.fromEntries((state.requests.at(index) ?? new URLSearchParams()).entries());
  const withParam = (name: string) => state.requests.filter((request) => request.has(name));
  return { handler, state, params, withParam };
}
