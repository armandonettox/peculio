import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { accountsKey } from "./accounts";
import { api, unwrap } from "./client";
import type { components } from "./schema";

export type Transaction = components["schemas"]["TransactionOut"];
export type TransactionSplit = components["schemas"]["TransactionSplitOut"];
export type TransactionCreate = components["schemas"]["TransactionCreate"];
export type TransactionSplitCreate = components["schemas"]["TransactionSplitCreate"];
export type Counterparty = components["schemas"]["CounterpartyOut"];

export const transactionsKey = ["transactions"] as const;
export const counterpartiesKey = ["counterparties"] as const;

// Quantos lancamentos vem por vez; "Carregar mais" busca a pagina seguinte
export const PAGE_SIZE = 25;

export type TransactionFilters = {
  accountId?: string;
  categoryId?: string;
  tagId?: string;
  // AAAA-MM-DD
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  // Valores no formato da API ("1234.50")
  minAmount?: string;
  maxAmount?: string;
};

function toQuery(filters: TransactionFilters, offset: number) {
  return {
    limit: PAGE_SIZE,
    offset,
    ...(filters.accountId ? { account_id: filters.accountId } : {}),
    ...(filters.categoryId ? { category_id: filters.categoryId } : {}),
    ...(filters.tagId ? { tag_id: filters.tagId } : {}),
    ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.minAmount ? { min_amount: filters.minAmount } : {}),
    ...(filters.maxAmount ? { max_amount: filters.maxAmount } : {}),
  };
}

export function useTransactions(filters: TransactionFilters, { enabled = true }: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: [...transactionsKey, filters],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      unwrap(api.client.GET("/api/v1/transactions", { params: { query: toQuery(filters, pageParam) } })),
    getNextPageParam: (last) => (last.offset + last.limit < last.total ? last.offset + last.limit : undefined),
  });
}

// Criar, editar ou apagar um lancamento muda o saldo das contas e pode criar uma contraparte nova:
// recarrega as tres listas.
function useRefreshAfterChange() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: transactionsKey }),
      queryClient.invalidateQueries({ queryKey: accountsKey }),
      queryClient.invalidateQueries({ queryKey: counterpartiesKey }),
    ]);
}

export function useCreateTransaction() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: (body: TransactionCreate) => unwrap(api.client.POST("/api/v1/transactions", { body })),
    onSuccess: refresh,
  });
}

export function useUpdateTransaction() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TransactionCreate }) =>
      unwrap(
        api.client.PUT("/api/v1/transactions/{transaction_id}", { params: { path: { transaction_id: id } }, body }),
      ),
    onSuccess: refresh,
  });
}

/** Nomes de despesa ou receita ja usados, para sugerir ao digitar. */
export function useCounterparties(type: "expense" | "revenue", search: string, { enabled = true } = {}) {
  return useQuery({
    queryKey: [...counterpartiesKey, type, search],
    enabled,
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/transactions/counterparties", {
          params: { query: { type, ...(search ? { q: search } : {}), limit: 8 } },
        }),
      ),
    staleTime: 30_000,
  });
}
