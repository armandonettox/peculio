import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { accountsKey } from "./accounts";
import { api, unwrap } from "./client";
import { billsKey, budgetsKey, dashboardKey, piggyBanksKey, reportsKey } from "./query-keys";
import type { components } from "./schema";
import { transactionsKey } from "./transactions";

export type ReconciliationView = components["schemas"]["ReconciliationViewOut"];
export type ReconciliationRow = components["schemas"]["ReconRowOut"];
export type ClosedReconciliation = components["schemas"]["ReconciliationOut"];

export const reconciliationKey = ["reconciliation"] as const;

/** O que a pessoa leu no extrato: o saldo (texto da API, "1234.50") e a data dele (AAAA-MM-DD). */
export type Statement = { accountId: string; balance: string; date: string };

/** A conciliacao de uma conta contra o extrato informado. */
export function useReconciliation(statement: Statement | null) {
  return useQuery({
    queryKey: [...reconciliationKey, "view", statement],
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/reconciliation/{account_id}", {
          params: {
            path: { account_id: statement!.accountId },
            query: { statement_balance: statement!.balance, statement_date: statement!.date },
          },
        }),
      ),
    enabled: statement !== null,
    // Marcar um lancamento recarrega a tela: a lista antiga fica visivel ate a nova chegar, sem piscar
    placeholderData: keepPreviousData,
  });
}

export function useReconciliationHistory(accountId: string | null) {
  return useQuery({
    queryKey: [...reconciliationKey, "history", accountId],
    queryFn: () =>
      unwrap(api.client.GET("/api/v1/reconciliation/{account_id}/history", { params: { path: { account_id: accountId! } } })),
    enabled: accountId !== null,
  });
}

// Conferir muda so a conciliacao e as marcas que a lista de lancamentos mostra
function useRefreshReconciliation() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([reconciliationKey, transactionsKey].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export function useSetCleared(accountId: string) {
  const refresh = useRefreshReconciliation();
  return useMutation({
    mutationFn: ({ splitIds, cleared }: { splitIds: string[]; cleared: boolean }) =>
      unwrap(
        api.client.PUT("/api/v1/reconciliation/{account_id}/cleared", {
          params: { path: { account_id: accountId } },
          body: { split_ids: splitIds, cleared },
        }),
      ),
    onSuccess: refresh,
  });
}

// O ajuste cria um lancamento de verdade: muda saldos, orcamentos, relatorios e o painel
export function useCreateAdjustment(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (statement: Statement) =>
      unwrap(
        api.client.POST("/api/v1/reconciliation/{account_id}/adjustment", {
          params: { path: { account_id: accountId } },
          body: { statement_balance: statement.balance, statement_date: statement.date },
        }),
      ),
    onSuccess: () =>
      Promise.all(
        [reconciliationKey, transactionsKey, accountsKey, budgetsKey, billsKey, piggyBanksKey, reportsKey, dashboardKey].map(
          (queryKey) => queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

export function useCloseReconciliation(accountId: string) {
  const refresh = useRefreshReconciliation();
  return useMutation({
    mutationFn: (statement: Statement) =>
      unwrap(
        api.client.POST("/api/v1/reconciliation/{account_id}/close", {
          params: { path: { account_id: accountId } },
          body: { statement_balance: statement.balance, statement_date: statement.date },
        }),
      ),
    onSuccess: refresh,
  });
}

export function useUndoReconciliation(accountId: string) {
  const refresh = useRefreshReconciliation();
  return useMutation({
    mutationFn: (reconciliationId: string) =>
      unwrap(
        api.client.DELETE("/api/v1/reconciliation/{account_id}/closed/{reconciliation_id}", {
          params: { path: { account_id: accountId, reconciliation_id: reconciliationId } },
        }),
      ),
    onSuccess: refresh,
  });
}
