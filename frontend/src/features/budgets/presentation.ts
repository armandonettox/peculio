import type { BudgetPeriod, BudgetProgress } from "@/api/budgets";
import { formatMoney, isNegativeMoney, negateMoney } from "@/lib/money";

export const PERIOD_LABELS: Record<BudgetPeriod, string> = {
  weekly: "Semanal",
  monthly: "Mensal",
  yearly: "Anual",
};

export const PERIODS: BudgetPeriod[] = ["weekly", "monthly", "yearly"];

// A partir de quantos % do limite o orcamento passa a ser "perto do limite"
export const WARNING_AT_PERCENT = 80;

export type ProgressState = "ok" | "warning" | "over";

/** ok: abaixo de 80%; warning: de 80% a 99%; over: limite atingido ou ultrapassado. */
export function progressState(percent: number): ProgressState {
  if (percent >= 100) return "over";
  if (percent >= WARNING_AT_PERCENT) return "warning";
  return "ok";
}

/** "Restam R$ 449,50" ou, se passou do limite, "Passou R$ 30,00 do limite". */
export function remainingText(item: Pick<BudgetProgress, "remaining" | "currency_code">): string {
  if (isNegativeMoney(item.remaining)) {
    return `Passou ${formatMoney(negateMoney(item.remaining), item.currency_code)} do limite`;
  }
  return `Restam ${formatMoney(item.remaining, item.currency_code)}`;
}

export const STATE_LABELS: Record<ProgressState, string | null> = {
  ok: null,
  warning: "Perto do limite",
  over: "Limite atingido",
};
