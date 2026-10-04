import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { budgetsKey, dashboardKey } from "./query-keys";
import type { components } from "./schema";

export type EnvelopeMonth = components["schemas"]["EnvelopeMonthOut"];
export type EnvelopeGroup = components["schemas"]["EnvelopeGroupOut"];
export type Envelope = components["schemas"]["EnvelopeOut"];

// Ficam sob a chave dos orcamentos: lancamento, conta e orcamento mudados ja a invalidam e recarregam os envelopes
export const envelopesKey = [...budgetsKey, "envelopes"] as const;

/** Os envelopes de um mes. `month` e o primeiro dia do mes (AAAA-MM-DD). */
export function useEnvelopes(month: string) {
  return useQuery({
    queryKey: [...envelopesKey, month],
    queryFn: () => unwrap(api.client.GET("/api/v1/envelopes", { params: { query: { month: month.slice(0, 7) } } })),
  });
}

// A resposta ja traz o mes inteiro atualizado: vai direto para o cache, sem esperar outra ida ao servidor
function useApplyMonth(month: string) {
  const queryClient = useQueryClient();
  return (data: EnvelopeMonth) => {
    queryClient.setQueryData([...envelopesKey, month], data);
    // Os meses seguintes herdam a sobra deste: ficam velhos ate recarregar
    void queryClient.invalidateQueries({ queryKey: envelopesKey, refetchType: "none" });
    void queryClient.invalidateQueries({ queryKey: dashboardKey });
  };
}

export function useSetAllocation(month: string) {
  const apply = useApplyMonth(month);
  return useMutation({
    mutationFn: ({ budgetId, amount }: { budgetId: string; amount: string }) =>
      unwrap(
        api.client.PUT("/api/v1/envelopes/{budget_id}/{month}", {
          params: { path: { budget_id: budgetId, month: month.slice(0, 7) } },
          body: { amount },
        }),
      ),
    onSuccess: apply,
  });
}

export function useMoveMoney(month: string) {
  const apply = useApplyMonth(month);
  return useMutation({
    mutationFn: (body: { fromBudgetId: string; toBudgetId: string; amount: string }) =>
      unwrap(
        api.client.POST("/api/v1/envelopes/move", {
          body: {
            from_budget_id: body.fromBudgetId,
            to_budget_id: body.toBudgetId,
            month: month.slice(0, 7),
            amount: body.amount,
          },
        }),
      ),
    onSuccess: apply,
  });
}
