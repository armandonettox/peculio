import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { budgetsKey, dashboardKey } from "./query-keys";
import type { components } from "./schema";

export type EnvelopeMonth = components["schemas"]["EnvelopeMonthFullOut"];
export type EnvelopeGroup = components["schemas"]["EnvelopeGroupFullOut"];
export type Envelope = components["schemas"]["EnvelopeFullOut"];
export type Template = components["schemas"]["TemplateOut"];
export type TemplateIn = components["schemas"]["TemplateIn"];
export type TemplateKind = Template["kind"];
export type TemplatePreview = components["schemas"]["TemplatePreviewOut"];
export type PreviewGroup = components["schemas"]["PreviewGroupOut"];
export type PreviewRow = components["schemas"]["PreviewRowOut"];

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

/** O que aplicar os templates faria neste mes, sem gravar nada. So busca quando a janela esta aberta (`enabled`). */
export function useTemplatePreview({ month, overwrite, enabled }: { month: string; overwrite: boolean; enabled: boolean }) {
  return useQuery({
    queryKey: [...envelopesKey, "preview", month, overwrite],
    enabled,
    // A previa vale so para o momento em que a pessoa olha: nunca reaproveita uma antiga
    gcTime: 0,
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/envelopes/templates/preview", {
          params: { query: { month: month.slice(0, 7), overwrite } },
        }),
      ),
  });
}

export function useApplyTemplates(month: string) {
  const apply = useApplyMonth(month);
  return useMutation({
    mutationFn: (overwrite: boolean) =>
      unwrap(api.client.POST("/api/v1/envelopes/templates/apply", { body: { month: month.slice(0, 7), overwrite } })),
    onSuccess: apply,
  });
}

// Definir ou tirar o template muda o selo de meta do mes: recarrega os envelopes
export function useRemoveTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (budgetId: string) =>
      unwrap(api.client.DELETE("/api/v1/envelopes/{budget_id}/template", { params: { path: { budget_id: budgetId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: envelopesKey }),
  });
}

export function useSetTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ budgetId, body }: { budgetId: string; body: TemplateIn }) =>
      unwrap(api.client.PUT("/api/v1/envelopes/{budget_id}/template", { params: { path: { budget_id: budgetId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: envelopesKey }),
  });
}
