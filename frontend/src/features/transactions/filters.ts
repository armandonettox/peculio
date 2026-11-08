import { i18n } from "@/i18n";
import type { TransactionFilters, TransactionStatus } from "@/api/transactions";

export type KindFilter = "withdrawal" | "deposit" | "transfer" | "credit_card_expense";

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
  status: "situacao",
} as const satisfies Record<keyof TransactionFilters, string>;

const KIND_PARAM = "tipo";

// Na ordem do Mobills: Efetuadas, Pendentes, Movimentacoes fixas, Ignoradas
export const STATUSES: TransactionStatus[] = ["done", "pending", "fixed", "ignored"];

const FIELDS = Object.keys(PARAM) as (keyof TransactionFilters)[];

export function readFilters(params: URLSearchParams): TransactionFilters {
  const filters: TransactionFilters = {};
  for (const field of FIELDS) {
    const value = params.get(PARAM[field]);
    if (value) (filters as Record<string, string>)[field] = value;
  }
  // Valor que nao e uma situacao conhecida (link antigo ou digitado a mao) nao filtra nada
  if (filters.status && !STATUSES.includes(filters.status)) delete filters.status;
  return filters;
}

export function readKind(params: URLSearchParams): KindFilter | null {
  const value = params.get(KIND_PARAM);
  if (value === "withdrawal" || value === "deposit" || value === "transfer" || value === "credit_card_expense") return value;
  return null;
}

export function writeKind(params: URLSearchParams, kind: KindFilter | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (kind) next.set(KIND_PARAM, kind);
  else next.delete(KIND_PARAM);
  return next;
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
    return i18n.t("transactions.filters.dateRangeInvalid");
  }
  return undefined;
}
