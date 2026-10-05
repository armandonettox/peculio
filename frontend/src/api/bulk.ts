import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { reconciliationKey } from "./reconciliation";
import type { components } from "./schema";
import { useRefreshAfterChange } from "./transactions";

export type BulkRequest = components["schemas"]["BulkIn"];
export type BulkResult = components["schemas"]["BulkOut"];
export type BulkAction = BulkRequest["action"];

// Acao em massa muda lancamentos como a edicao comum (saldos, orcamentos, relatorios, painel) e a conciliacao mostra os
// mesmos lancamentos: recarrega tudo isso.
export function useBulkTransactions() {
  const refresh = useRefreshAfterChange();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkRequest) => unwrap(api.client.POST("/api/v1/transactions/bulk", { body })),
    onSuccess: () => Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: reconciliationKey })]),
  });
}
