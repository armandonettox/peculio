import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { budgetsKey } from "./query-keys";
import type { components } from "./schema";
import { transactionsKey } from "./transactions";

export type Budget = components["schemas"]["BudgetOut"];
export type BudgetProgress = components["schemas"]["BudgetProgressOut"];
export type BudgetCreate = components["schemas"]["BudgetCreate"];
export type BudgetUpdate = components["schemas"]["BudgetUpdate"];
export type BudgetPeriod = components["schemas"]["BudgetPeriod"];

export { budgetsKey };

// Quem tem mais de 200 orcamentos e raro; a tela busca tudo de uma vez (o maximo da API)
const PAGE_LIMIT = 200;

/** Orcamentos com o gasto do periodo que contem a data `on` (AAAA-MM-DD). */
export function useBudgetsProgress({ on, includeArchived }: { on: string; includeArchived: boolean }) {
  return useQuery({
    queryKey: [...budgetsKey, "progress", { on, includeArchived }],
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/budgets/progress", {
          params: { query: { on, include_archived: includeArchived } },
        }),
      ),
  });
}

/** Lista simples, para escolher um orcamento no formulario de lancamento. */
export function useBudgets({ activeOnly }: { activeOnly: boolean }) {
  return useQuery({
    queryKey: [...budgetsKey, "list", { activeOnly }],
    queryFn: async () => {
      const query = activeOnly ? { limit: PAGE_LIMIT, active: true } : { limit: PAGE_LIMIT };
      const page = await unwrap(api.client.GET("/api/v1/budgets", { params: { query } }));
      return page.items;
    },
  });
}

// Mudar um orcamento muda o progresso; excluir tambem solta os lancamentos ligados a ele
function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: budgetsKey }),
      queryClient.invalidateQueries({ queryKey: transactionsKey }),
    ]);
}

export function useCreateBudget() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: BudgetCreate) => unwrap(api.client.POST("/api/v1/budgets", { body })),
    onSuccess: refresh,
  });
}

export function useUpdateBudget() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: BudgetUpdate }) =>
      unwrap(api.client.PATCH("/api/v1/budgets/{budget_id}", { params: { path: { budget_id: id } }, body })),
    onSuccess: refresh,
  });
}

export function useDeleteBudget() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/budgets/{budget_id}", { params: { path: { budget_id: id } } })),
    onSuccess: refresh,
  });
}
