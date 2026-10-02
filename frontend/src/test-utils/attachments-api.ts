import { http, HttpResponse } from "msw";

import type { Attachment } from "@/api/attachments";

let counter = 0;

export function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  counter += 1;
  return {
    id: `f0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    transaction_id: "40000000-0000-4000-8000-000000000001",
    original_name: `comprovante-${counter}.pdf`,
    content_type: "application/pdf",
    size_bytes: 2048,
    created_at: "2026-03-10T15:00:00Z",
    ...overrides,
  };
}

type NextError = { status: number; code: string };
type Recorded = {
  method: string;
  path: string;
  authorization?: string | null;
  contentType?: string | null;
  fileName?: string;
  fileSize?: number;
};

/**
 * API de anexos de mentira, com estado. Guarda cada chamada (cabecalho de autorizacao, nome do arquivo
 * enviado) para o teste conferir. Se receber `onCountChange`, avisa quando o numero de anexos de um
 * lancamento muda, para a lista de lancamentos refletir.
 */
export function fakeAttachmentsApi(
  initial: Attachment[] = [],
  { onCountChange }: { onCountChange?: (transactionId: string, count: number) => void } = {},
) {
  const state = {
    items: [...initial],
    requests: [] as Recorded[],
    listError: false,
    nextUploadError: null as NextError | null,
    nextDeleteError: null as NextError | null,
    nextDownloadError: null as NextError | null,
    // Segura a resposta do envio ate o teste chamar release()
    uploadedName: "enviado.pdf",
    holdUpload: false,
    release: null as (() => void) | null,
  };

  const fail = (error: NextError) =>
    HttpResponse.json({ detail: "erro", code: error.code }, { status: error.status });
  const countOf = (transactionId: string) => state.items.filter((item) => item.transaction_id === transactionId).length;

  const handlers = [
    http.get("*/api/v1/transactions/:id/attachments", ({ request, params }) => {
      state.requests.push({ method: "GET", path: `/transactions/${params.id}/attachments`, authorization: request.headers.get("authorization") });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const items = state.items
        .filter((item) => item.transaction_id === params.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return HttpResponse.json(items);
    }),

    http.post("*/api/v1/transactions/:id/attachments", async ({ request, params }) => {
      state.requests.push({
        method: "POST",
        path: `/transactions/${params.id}/attachments`,
        authorization: request.headers.get("authorization"),
        contentType: request.headers.get("content-type"),
      });
      if (state.holdUpload) {
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      }
      const error = state.nextUploadError;
      state.nextUploadError = null;
      if (error) return fail(error);
      const created = makeAttachment({
        transaction_id: String(params.id),
        // O conteudo do arquivo nao chega neste handler (File do jsdom x fetch do Node): o teste diz o nome
        original_name: state.uploadedName,
        size_bytes: 4096,
        created_at: new Date().toISOString(),
      });
      state.items.push(created);
      onCountChange?.(String(params.id), countOf(String(params.id)));
      return HttpResponse.json(created, { status: 201 });
    }),

    http.get("*/api/v1/attachments/:id/download", ({ request, params }) => {
      state.requests.push({
        method: "GET",
        path: `/attachments/${params.id}/download`,
        authorization: request.headers.get("authorization"),
      });
      const error = state.nextDownloadError;
      state.nextDownloadError = null;
      if (error) return fail(error);
      return new HttpResponse("conteudo do arquivo", { headers: { "content-type": "application/pdf" } });
    }),

    http.delete("*/api/v1/attachments/:id", ({ request, params }) => {
      state.requests.push({ method: "DELETE", path: `/attachments/${params.id}`, authorization: request.headers.get("authorization") });
      const error = state.nextDeleteError;
      state.nextDeleteError = null;
      if (error) return fail(error);
      const removed = state.items.find((item) => item.id === params.id);
      state.items = state.items.filter((item) => item.id !== params.id);
      if (removed) onCountChange?.(removed.transaction_id, countOf(removed.transaction_id));
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  const writes = () => state.requests.filter((request) => request.method !== "GET");
  return { handlers, state, writes };
}
