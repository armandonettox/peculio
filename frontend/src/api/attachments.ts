import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { attachmentsKey } from "./query-keys";
import type { components } from "./schema";
import { transactionsKey } from "./transactions";

export type Attachment = components["schemas"]["AttachmentOut"];

export { attachmentsKey };

// Mesmos limites do backend. O navegador confere o tamanho antes de enviar para nao subir
// 50 MB so para receber uma recusa.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TRANSACTION = 10;
export const ATTACHMENT_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,application/pdf,image/jpeg,image/png,image/webp,text/plain,text/csv";

export function useAttachments(transactionId: string) {
  return useQuery({
    queryKey: [...attachmentsKey, transactionId],
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/transactions/{transaction_id}/attachments", {
          params: { path: { transaction_id: transactionId } },
        }),
      ),
  });
}

// A contagem de anexos aparece na lista de lancamentos, entao ela recarrega junto
function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: attachmentsKey }),
      queryClient.invalidateQueries({ queryKey: transactionsKey }),
    ]);
}

export function useUploadAttachment(transactionId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (file: File) =>
      unwrap(
        api.client.POST("/api/v1/transactions/{transaction_id}/attachments", {
          params: { path: { transaction_id: transactionId } },
          // O tipo gerado diz "string" para o arquivo; o corpo de verdade e multipart
          body: { file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append("file", file, file.name);
            return form;
          },
        }),
      ),
    onSuccess: refresh,
  });
}

export function useDeleteAttachment() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.client.DELETE("/api/v1/attachments/{attachment_id}", { params: { path: { attachment_id: id } } }),
      ),
    onSuccess: refresh,
  });
}

/**
 * Baixa o arquivo com o token no cabecalho (o token nunca vai na URL), guarda numa URL temporaria
 * do navegador e clica num link para salvar. A URL temporaria e revogada logo depois.
 */
export async function downloadAttachment(attachment: Pick<Attachment, "id" | "original_name">): Promise<void> {
  const blob = await unwrap(
    api.client.GET("/api/v1/attachments/{attachment_id}/download", {
      params: { path: { attachment_id: attachment.id } },
      parseAs: "blob",
    }),
  );
  const url = URL.createObjectURL(blob as Blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.original_name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // O clique ja iniciou o salvamento; a URL temporaria nao precisa ficar na memoria
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
