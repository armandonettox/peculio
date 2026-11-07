import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { ApiError } from "./errors";
import { plansKey } from "./query-keys";
import type { components } from "./schema";

export type MonthlyPlan = components["schemas"]["MonthlyPlanOut"];
export type PlanRow = components["schemas"]["PlanRowOut"];
export type PlanSummary = components["schemas"]["PlanSummaryOut"];
export type PlanItemIn = components["schemas"]["PlanItemIn"];
export type MonthlyPlanCreate = components["schemas"]["MonthlyPlanCreate"];
export type MonthlyPlanUpdate = components["schemas"]["MonthlyPlanUpdate"];
export type CardCounting = components["schemas"]["CardCounting"];

export { plansKey };

/**
 * O planejamento de um mes ("AAAA-MM") com o gasto de cada categoria. Mes sem planejamento nao e erro: devolve null,
 * e a tela mostra o convite para criar um.
 */
export function useMonthlyPlan(month: string) {
  return useQuery({
    queryKey: [...plansKey, "monthly", month],
    queryFn: async (): Promise<MonthlyPlan | null> => {
      try {
        return await unwrap(api.client.GET("/api/v1/plans/monthly/{month}", { params: { path: { month } } }));
      } catch (error) {
        if (error instanceof ApiError && error.code === "monthly_plan_not_found") return null;
        throw error;
      }
    },
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: plansKey });
}

export function useCreateMonthlyPlan() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ month, body }: { month: string; body: MonthlyPlanCreate }) =>
      unwrap(api.client.POST("/api/v1/plans/monthly/{month}", { params: { path: { month } }, body })),
    onSuccess: refresh,
  });
}

export function useUpdateMonthlyPlan() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ month, body }: { month: string; body: MonthlyPlanUpdate }) =>
      unwrap(api.client.PATCH("/api/v1/plans/monthly/{month}", { params: { path: { month } }, body })),
    onSuccess: refresh,
  });
}

/** Grava varios limites: cria os novos e troca o valor e o alerta dos que ja existem. */
export function usePutPlanItems() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ month, items }: { month: string; items: PlanItemIn[] }) =>
      unwrap(api.client.PUT("/api/v1/plans/monthly/{month}/items", { params: { path: { month } }, body: { items } })),
    onSuccess: refresh,
  });
}

export function useDeletePlanItem() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ month, categoryId }: { month: string; categoryId: string }) =>
      unwrap(
        api.client.DELETE("/api/v1/plans/monthly/{month}/items/{category_id}", {
          params: { path: { month, category_id: categoryId } },
        }),
      ),
    onSuccess: refresh,
  });
}

export function useCopyPreviousPlan() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (month: string) =>
      unwrap(api.client.POST("/api/v1/plans/monthly/{month}/copy-previous", { params: { path: { month } } })),
    onSuccess: refresh,
  });
}

export function useDeleteAllPlans() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => unwrap(api.client.DELETE("/api/v1/plans/monthly")),
    onSuccess: refresh,
  });
}
