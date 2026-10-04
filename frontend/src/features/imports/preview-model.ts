import type { ImportConfirm, ImportPreview, ImportRow } from "@/api/imports";

// Quantas linhas da previa aparecem por vez (um extrato pode ter milhares)
export const PAGE_SIZE = 100;

/** Linha com erro nunca entra: nao ha o que importar. */
export const isSelectable = (row: ImportRow): boolean => row.status !== "error";

/** O que ja vem marcado: so as novas. As que parecem repetidas ficam desmarcadas, de proposito. */
export function newRows(rows: ImportRow[]): Set<number> {
  return new Set(rows.filter((row) => row.status === "new").map((row) => row.index));
}

/** Todas as que podem entrar, inclusive as repetidas (a pessoa pediu). */
export function allSelectable(rows: ImportRow[]): Set<number> {
  return new Set(rows.filter(isSelectable).map((row) => row.index));
}

/** Texto da situacao. A cor nunca e a unica pista. */
export function statusLabel(row: Pick<ImportRow, "status" | "duplicate_kind">): string {
  if (row.status === "error") return "Erro";
  if (row.status === "new") return "Nova";
  return row.duplicate_kind === "same_id" ? "Já importada" : "Parece repetida";
}

/** O corpo da confirmacao: so as linhas marcadas, na ordem do arquivo. Linha com erro nunca vai. */
export function rowsToImport(rows: ImportRow[], chosen: ReadonlySet<number>): ImportConfirm["rows"] {
  return rows
    .filter((row) => isSelectable(row) && chosen.has(row.index) && row.date && row.amount)
    .map((row) => ({
      date: row.date as string,
      description: row.description,
      amount: row.amount as string,
      external_id: row.external_id,
    }));
}

export type PageSlice = { rows: ImportRow[]; page: number; pages: number; first: number; last: number };

/** A pagina `page` (a partir de 0) das linhas; uma pagina fora do intervalo vira a mais proxima. */
export function pageOf(rows: ImportRow[], page: number, size = PAGE_SIZE): PageSlice {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const start = current * size;
  const slice = rows.slice(start, start + size);
  return { rows: slice, page: current, pages, first: rows.length === 0 ? 0 : start + 1, last: start + slice.length };
}

/** As contagens da previa em portugues: "4 novas" e "1 repetida · 1 com erro" (no singular quando e 1). */
export function countsParts(counts: ImportPreview["counts"]): { news: string; rest: string } {
  const news = `${counts.new} ${counts.new === 1 ? "nova" : "novas"}`;
  const duplicates = `${counts.duplicate} ${counts.duplicate === 1 ? "repetida" : "repetidas"}`;
  return { news, rest: `${duplicates} · ${counts.error} com erro` };
}

/** "1 lançamento" ou "3 lançamentos". */
export function entriesText(count: number): string {
  return `${count} ${count === 1 ? "lançamento" : "lançamentos"}`;
}
