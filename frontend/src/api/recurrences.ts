import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { accountsKey } from "./accounts";
import { api, unwrap } from "./client";
import { billsKey, budgetsKey, dashboardKey, recurrencesKey } from "./query-keys";
import type { components } from "./schema";
import { transactionsKey } from "./transactions";

export type Recurrence = components["schemas"]["RecurrenceOut"];
export type RecurrenceCreate = components["schemas"]["RecurrenceCreate"];
export type RecurrenceUpdate = components["schemas"]["RecurrenceUpdate"];
export type RecurrenceFrequency = components["schemas"]["RecurrenceFrequency"];

export { recurrencesKey };

// Quem tem mais de 200 recorrentes e raro; a tela busca tudo de uma vez (o maximo da API)
const PAGE_LIMIT = 200;

export function useRecurrences({ includePaused }: { includePaused: boolean }) {
  return useQuery({
    queryKey: [...recurrencesKey, "list", { includePaused }],
    queryFn: async () => {
      const query = includePaused ? { limit: PAGE_LIMIT } : { limit: PAGE_LIMIT, active: true };
      const page = await unwrap(api.client.GET("/api/v1/recurrences", { params: { query } }));
      return page.items;
    },
  });
}

// Criar, mudar ou rodar uma recorrente pode criar lancamentos: recarrega tudo que eles tocam
function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [recurrencesKey, transactionsKey, accountsKey, budgetsKey, billsKey, dashboardKey].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
}

export function useCreateRecurrence() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: RecurrenceCreate) => unwrap(api.client.POST("/api/v1/recurrences", { body })),
    onSuccess: refresh,
  });
}

export function useUpdateRecurrence() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RecurrenceUpdate }) =>
      unwrap(api.client.PATCH("/api/v1/recurrences/{recurrence_id}", { params: { path: { recurrence_id: id } }, body })),
    onSuccess: refresh,
  });
}

export function useDeleteRecurrence() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/recurrences/{recurrence_id}", { params: { path: { recurrence_id: id } } })),
    onSuccess: refresh,
  });
}
