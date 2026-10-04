import { http, HttpResponse } from "msw";

import type { ImportMapping, ImportPreview, ImportResult, ImportRow } from "@/api/imports";

let counter = 0;

/** Uma linha da previa. Por padrao e uma linha nova, de saida, sem identificador do banco. */
export function makeRow(overrides: Partial<ImportRow> = {}): ImportRow {
  counter += 1;
  return {
    index: counter + 1,
    date: "2026-03-05",
    description: `Compra ${counter}`,
    amount: "-50.00",
    external_id: null,
    status: "new",
    duplicate_kind: null,
    reason: null,
    ...overrides,
  };
}

export function countsOf(rows: ImportRow[]) {
  return {
    new: rows.filter((row) => row.status === "new").length,
    duplicate: rows.filter((row) => row.status === "duplicate").length,
    error: rows.filter((row) => row.status === "error").length,
  };
}

export const SUGGESTED_MAPPING: ImportMapping = {
  date_column: 0,
  description_column: 1,
  amount_column: 2,
  debit_column: null,
  credit_column: null,
  has_header: true,
};

/** Resposta de previa de CSV com as colunas adivinhadas. */
export function makePreview(rows: ImportRow[], overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    format: "csv",
    account_id: "a0000000-0000-4000-8000-000000000001",
    columns: ["Data", "Descricao", "Valor"],
    sample: [["05/03/2026", "Compra", "-50,00"]],
    mapping: SUGGESTED_MAPPING,
    needs_mapping: false,
    rows,
    counts: countsOf(rows),
    ...overrides,
  };
}

/** CSV que o servidor nao conseguiu entender: a tela precisa pedir as colunas. */
export function makeNeedsMapping(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    format: "csv",
    account_id: "a0000000-0000-4000-8000-000000000001",
    columns: ["Dia", "Texto", "Entrada", "Saida", "Saldo"],
    sample: [
      ["05/03/2026", "Mercado", "", "50,00", "950,00"],
      ["06/03/2026", "Salario", "1000,00", "", "1950,00"],
    ],
    mapping: null,
    needs_mapping: true,
    rows: [],
    counts: { new: 0, duplicate: 0, error: 0 },
    ...overrides,
  };
}

export function makeOfxPreview(rows: ImportRow[]): ImportPreview {
  return makePreview(rows, { format: "ofx", columns: null, sample: null, mapping: null });
}

type NextError = { status: number; code: string; detail?: string };
export type RecordedPreview = { accountId: string | null; mapping: Record<string, unknown> | null; fileName: string | null; fileSize: number | null };
type Recorded = { method: string; path: string; body?: Record<string, unknown> };

/**
 * API de importacao de mentira. A cada pedido de previa devolve a proxima resposta da fila (a ultima se
 * a fila acabar), e guarda conta, colunas e arquivo enviados para o teste conferir. A confirmacao devolve
 * quantas linhas vieram (menos as que o teste mandar deixar de fora).
 */
export function fakeImportsApi(previews: ImportPreview[] = []) {
  const state = {
    previews: [...previews],
    previewCalls: [] as RecordedPreview[],
    requests: [] as Recorded[],
    nextPreviewError: null as NextError | null,
    nextConfirmError: null as NextError | null,
    skipOnConfirm: 0,
    // Segura a resposta da previa ate o teste chamar release()
    holdPreview: false,
    release: null as (() => void) | null,
  };

  const fail = (error: NextError) =>
    HttpResponse.json({ detail: error.detail ?? "erro", code: error.code }, { status: error.status });

  const handlers = [
    http.post("*/api/v1/imports/preview", async ({ request }) => {
      // O File do jsdom nao e o do undici, entao request.formData() quebra: le o corpo como texto
      const body = await request.text();
      // Cada parte do multipart: cabecalhos, linha em branco e o conteudo
      const part = (name: string) => body.split(/\r?\n--/).find((chunk) => chunk.includes(`name="${name}"`));
      const contentOf = (chunk: string | undefined) => (chunk === undefined ? null : chunk.replace(/^[\s\S]*?\r?\n\r?\n/, ""));
      const mapping = contentOf(part("mapping"));
      const filePart = part("file");
      state.previewCalls.push({
        accountId: contentOf(part("account_id")),
        mapping: mapping === null ? null : (JSON.parse(mapping) as Record<string, unknown>),
        fileName: filePart ? (/filename="([^"]*)"/.exec(filePart)?.[1] ?? null) : null,
        fileSize: filePart ? (contentOf(filePart) ?? "").length : null,
      });
      if (state.holdPreview) await new Promise<void>((resolve) => (state.release = resolve));
      const error = state.nextPreviewError;
      state.nextPreviewError = null;
      if (error) return fail(error);
      const next = state.previews.length > 1 ? state.previews.shift() : state.previews[0];
      return HttpResponse.json(next);
    }),

    http.post("*/api/v1/imports/confirm", async ({ request }) => {
      const body = (await request.json()) as { account_id: string; rows: unknown[] };
      state.requests.push({ method: "POST", path: "/imports/confirm", body: body as unknown as Record<string, unknown> });
      const error = state.nextConfirmError;
      state.nextConfirmError = null;
      if (error) return fail(error);
      const result: ImportResult = {
        created: Math.max(body.rows.length - state.skipOnConfirm, 0),
        skipped: Math.min(state.skipOnConfirm, body.rows.length),
      };
      return HttpResponse.json(result, { status: 201 });
    }),
  ];

  const confirms = () => state.requests.filter((request) => request.path === "/imports/confirm");
  return { handlers, state, confirms };
}
