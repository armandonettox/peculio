import type { ClosedReconciliation, ReconciliationRow, ReconciliationView } from "@/api/reconciliation";
import { i18n } from "@/i18n";
import { formatMoney, negateMoney } from "@/lib/money";

/** -1, 0 ou 1, lendo o texto do valor sem passar por float. */
export function signOf(value: string): -1 | 0 | 1 {
  if (/^-?0*(\.0*)?$/.test(value)) return 0;
  return value.startsWith("-") ? -1 : 1;
}

export type DifferenceInfo = { tone: "ok" | "statement_more" | "cleared_more"; text: string };

/** A diferenca (extrato - conferido) em uma frase: quem tem mais dinheiro, e quanto. */
export function differenceInfo(difference: string, currencyCode: string): DifferenceInfo {
  const sign = signOf(difference);
  if (sign === 0) return { tone: "ok", text: i18n.t("reconciliation.presentation.bate") };
  if (sign > 0) {
    return {
      tone: "statement_more",
      text: i18n.t("reconciliation.presentation.extratoTemAMais", { amount: formatMoney(difference, currencyCode) }),
    };
  }
  return {
    tone: "cleared_more",
    text: i18n.t("reconciliation.presentation.conferidoTemAMais", { amount: formatMoney(negateMoney(difference), currencyCode) }),
  };
}

export type AdjustmentPreview = { kind: "deposit" | "withdrawal"; amount: string; text: string };

/** O lancamento de ajuste que zeraria a diferenca. Sem diferenca, nao ha ajuste. */
export function adjustmentPreview(difference: string, currencyCode: string): AdjustmentPreview | null {
  const sign = signOf(difference);
  if (sign === 0) return null;
  if (sign > 0) {
    return {
      kind: "deposit",
      amount: difference,
      text: i18n.t("reconciliation.presentation.umaEntradaDe", { amount: formatMoney(difference, currencyCode) }),
    };
  }
  const amount = negateMoney(difference);
  return {
    kind: "withdrawal",
    amount,
    text: i18n.t("reconciliation.presentation.umaSaidaDe", { amount: formatMoney(amount, currencyCode) }),
  };
}

/** Os lancamentos que mudariam ao marcar (ou desmarcar) todos. */
export function idsToChange(rows: ReconciliationRow[], cleared: boolean): string[] {
  return rows.filter((row) => row.cleared !== cleared).map((row) => row.split_id);
}

export function clearedCount(rows: ReconciliationRow[]): number {
  return rows.filter((row) => row.cleared).length;
}

export function entriesText(count: number): string {
  return i18n.t("reconciliation.presentation.entries", { count });
}

/** Quantos lancamentos abertos ha alem dos que a tela traz. */
export function truncatedText(view: ReconciliationView): string | null {
  if (!view.truncated) return null;
  return i18n.t("reconciliation.presentation.mostrando", { shown: view.rows.length, total: view.total_rows });
}

export type HistoryStatus = { label: string; active: boolean };

export function historyStatus(item: ClosedReconciliation): HistoryStatus {
  return item.invalidated_at
    ? { label: i18n.t("reconciliation.presentation.desfeita"), active: false }
    : { label: i18n.t("reconciliation.presentation.fechada"), active: true };
}

export function lockedText(count: number): string {
  if (count === 0) return i18n.t("reconciliation.presentation.nenhumTravado");
  return i18n.t("reconciliation.presentation.travados", { entries: entriesText(count), count });
}
