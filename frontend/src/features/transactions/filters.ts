import type { TransactionFilters } from "@/api/transactions";

// Os filtros ficam na URL (/transacoes?conta=...&de=2026-03-01): o botao Voltar, o link
// copiado e um atalho vindo de outra tela abrem a lista ja filtrada.
const PARAM = {
  accountId: "conta",
  categoryId: "categoria",
  tagId: "tag",
  dateFrom: "de",
  dateTo: "ate",
  q: "busca",
  minAmount: "min",
  maxAmount: "max",
} as const satisfies Record<keyof TransactionFilters, string>;

const FIELDS = Object.keys(PARAM) as (keyof TransactionFilters)[];

export function readFilters(params: URLSearchParams): TransactionFilters {
  const filters: TransactionFilters = {};
  for (const field of FIELDS) {
    const value = params.get(PARAM[field]);
    if (value) filters[field] = value;
  }
  return filters;
}

/** Aplica mudancas aos filtros: valor vazio ou undefined remove o filtro da URL. */
export function writeFilters(params: URLSearchParams, patch: Partial<TransactionFilters>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const field of FIELDS) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (value) next.set(PARAM[field], value);
    else next.delete(PARAM[field]);
  }
  return next;
}

export function countActiveFilters(filters: TransactionFilters): number {
  return FIELDS.filter((field) => Boolean(filters[field])).length;
}

/** A data inicial nao pode ser depois da final (texto AAAA-MM-DD compara certo como string). */
export function dateRangeError(filters: TransactionFilters): string | undefined {
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return "A data inicial é depois da data final.";
  }
  return undefined;
}
