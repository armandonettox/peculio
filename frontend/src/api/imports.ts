import { useMutation, useQueryClient } from "@tanstack/react-query";

import { accountsKey } from "./accounts";
import { api, unwrap } from "./client";
import { billsKey, budgetsKey, dashboardKey, piggyBanksKey, reportsKey } from "./query-keys";
import type { components } from "./schema";
import { transactionsKey } from "./transactions";

export type ImportPreview = components["schemas"]["ImportPreviewOut"];
export type ImportRow = components["schemas"]["ImportRowOut"];
export type ImportMapping = components["schemas"]["ImportMapping"];
export type ImportConfirm = components["schemas"]["ImportConfirm"];
export type ImportResult = components["schemas"]["ImportResultOut"];

// Mesmos limites do backend. O navegador confere o tamanho antes de enviar, para nao subir
// um arquivo enorme so para receber uma recusa.
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_ACCEPT = ".csv,.ofx,.qfx,.txt,text/csv,text/plain,application/x-ofx";

export type PreviewInput = { accountId: string; file: File; mapping?: ImportMapping };

export function usePreviewImport() {
  return useMutation({
    mutationFn: ({ accountId, file, mapping }: PreviewInput) =>
      unwrap(
        api.client.POST("/api/v1/imports/preview", {
          // O tipo gerado diz "string" para o arquivo; o corpo de verdade e multipart
          body: { account_id: accountId, file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append("account_id", accountId);
            if (mapping) form.append("mapping", JSON.stringify(mapping));
            form.append("file", file, file.name);
            return form;
          },
        }),
      ),
  });
}

// Importar cria lancamentos: muda saldos, orcamentos, contas a pagar, cofrinhos, relatorios e o painel
export function useConfirmImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportConfirm) => unwrap(api.client.POST("/api/v1/imports/confirm", { body })),
    onSuccess: () =>
      Promise.all(
        [transactionsKey, accountsKey, budgetsKey, billsKey, piggyBanksKey, reportsKey, dashboardKey].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}
