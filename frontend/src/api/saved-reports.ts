import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { savedReportsKey } from "./query-keys";
import type { components } from "./schema";

export type SavedReport = components["schemas"]["SavedReportOut"];
export type SavedReportBody = components["schemas"]["SavedReportIn"];
export type ReportGroupBy = components["schemas"]["ReportGroupBy"];
export type ReportChart = components["schemas"]["ReportChart"];
export type ReportMeasure = components["schemas"]["ReportMeasure"];
export type SavedPeriod = components["schemas"]["ReportPeriod"];

export { savedReportsKey };

// Mesmo teto do servidor
export const MAX_SAVED_REPORTS = 30;

export function useSavedReports() {
  return useQuery({
    queryKey: [...savedReportsKey, "list"],
    queryFn: () => unwrap(api.client.GET("/api/v1/reports/saved")),
  });
}

function useRefreshSaved() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: savedReportsKey });
}

export function useCreateSavedReport() {
  const refresh = useRefreshSaved();
  return useMutation({
    mutationFn: (body: SavedReportBody) => unwrap(api.client.POST("/api/v1/reports/saved", { body })),
    onSuccess: refresh,
  });
}

export function useUpdateSavedReport() {
  const refresh = useRefreshSaved();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SavedReportBody }) =>
      unwrap(api.client.PUT("/api/v1/reports/saved/{report_id}", { params: { path: { report_id: id } }, body })),
    onSuccess: refresh,
  });
}

export function useDeleteSavedReport() {
  const refresh = useRefreshSaved();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/reports/saved/{report_id}", { params: { path: { report_id: id } } })),
    onSuccess: refresh,
  });
}
