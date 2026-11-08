import { useEffect } from "react";

import { useTransactions, type Transaction, type TransactionStatus } from "@/api/transactions";
import type { MonthRange } from "@/lib/month";

// Teto de paginas buscadas: com 25 por pagina sao 500 lancamentos no mes, mais do que um painel precisa
const MAX_PAGES = 20;

/**
 * Todos os lancamentos de um mes. A API entrega em paginas; este hook pede as seguintes sozinho, ate o teto,
 * para o calendario e a frequencia de gastos contarem o mes inteiro e nao so a primeira pagina.
 */
export function useMonthTransactions(range: MonthRange, { status, enabled = true }: { status?: TransactionStatus; enabled?: boolean } = {}) {
  const query = useTransactions({ dateFrom: range.from, dateTo: range.to, ...(status ? { status } : {}) }, { enabled });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const pageCount = query.data?.pages.length ?? 0;

  useEffect(() => {
    if (enabled && hasNextPage && !isFetchingNextPage && pageCount < MAX_PAGES) void fetchNextPage();
  }, [enabled, hasNextPage, isFetchingNextPage, pageCount, fetchNextPage]);

  const items: Transaction[] = query.data?.pages.flatMap((page) => page.items) ?? [];
  // Ainda carregando paginas (ou parou no teto): a tela nao deve tratar a lista como completa
  const isComplete = !hasNextPage;
  return { query, items, isComplete };
}
