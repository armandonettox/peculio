import { useInfiniteQuery } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import type { components } from "./schema";

export type Transaction = components["schemas"]["TransactionOut"];
export type TransactionSplit = components["schemas"]["TransactionSplitOut"];

export const transactionsKey = ["transactions"] as const;

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
