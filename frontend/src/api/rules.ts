import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { billsKey, budgetsKey, reportsKey, rulesKey } from "./query-keys";
import type { components } from "./schema";
import { transactionsKey } from "./transactions";

export type Rule = components["schemas"]["RuleOut"];
export type RuleCreate = components["schemas"]["RuleCreate"];
export type RuleUpdate = components["schemas"]["RuleUpdate"];
export type RuleGroup = components["schemas"]["RuleGroupOut"];
export type RuleGroupCreate = components["schemas"]["RuleGroupCreate"];
export type RuleGroupUpdate = components["schemas"]["RuleGroupUpdate"];
export type RuleTrigger = components["schemas"]["TriggerIn"];
export type RuleAction = components["schemas"]["ActionIn"];
export type RuleMatchMode = components["schemas"]["MatchMode"];
export type RuleRun = components["schemas"]["RuleRunIn"];
export type RulePreview = components["schemas"]["RulePreviewOut"];
export type RulePreviewItem = components["schemas"]["RuleRunItem"];
export type RuleApplied = components["schemas"]["RuleApplyOut"];

export { rulesKey };

// Quem tem mais de 200 regras e raro; a tela busca tudo de uma vez (o maximo da API)
const PAGE_LIMIT = 200;

/** Todas as regras, na ordem de execucao (grupos pela posicao, depois as sem grupo). */
export function useRules() {
  return useQuery({
    queryKey: [...rulesKey, "list"],
    queryFn: async () => {
      const page = await unwrap(api.client.GET("/api/v1/rules", { params: { query: { limit: PAGE_LIMIT } } }));
      return page.items;
    },
  });
}

export function useRuleGroups() {
  return useQuery({
    queryKey: [...rulesKey, "groups"],
    queryFn: () => unwrap(api.client.GET("/api/v1/rule-groups")),
  });
}

function useRefreshRules() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: rulesKey });
}

export function useCreateRule() {
  const refresh = useRefreshRules();
  return useMutation({
    mutationFn: (body: RuleCreate) => unwrap(api.client.POST("/api/v1/rules", { body })),
    onSuccess: refresh,
  });
}

export function useUpdateRule() {
  const refresh = useRefreshRules();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RuleUpdate }) =>
      unwrap(api.client.PATCH("/api/v1/rules/{rule_id}", { params: { path: { rule_id: id } }, body })),
    onSuccess: refresh,
  });
}

export function useDeleteRule() {
  const refresh = useRefreshRules();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/rules/{rule_id}", { params: { path: { rule_id: id } } })),
    onSuccess: refresh,
  });
}

export function useCreateRuleGroup() {
  const refresh = useRefreshRules();
  return useMutation({
    mutationFn: (body: RuleGroupCreate) => unwrap(api.client.POST("/api/v1/rule-groups", { body })),
    onSuccess: refresh,
  });
}

export function useUpdateRuleGroup() {
  const refresh = useRefreshRules();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RuleGroupUpdate }) =>
      unwrap(api.client.PATCH("/api/v1/rule-groups/{group_id}", { params: { path: { group_id: id } }, body })),
    onSuccess: refresh,
  });
}

// Excluir o grupo solta as regras dele, entao a lista de regras tambem muda
export function useDeleteRuleGroup() {
  const refresh = useRefreshRules();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/rule-groups/{group_id}", { params: { path: { group_id: id } } })),
    onSuccess: refresh,
  });
}

/** Mostra o que as regras preencheriam nos lancamentos antigos. Nao grava nada. */
export function usePreviewRules() {
  return useMutation({
    mutationFn: (body: RuleRun) => unwrap(api.client.POST("/api/v1/rules/preview", { body })),
  });
}

// Aplicar muda lancamentos, e com isso orcamentos, contas a pagar e relatorios
export function useApplyRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RuleRun) => unwrap(api.client.POST("/api/v1/rules/apply", { body })),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: transactionsKey }),
        queryClient.invalidateQueries({ queryKey: budgetsKey }),
        queryClient.invalidateQueries({ queryKey: billsKey }),
        queryClient.invalidateQueries({ queryKey: reportsKey }),
      ]),
  });
}
