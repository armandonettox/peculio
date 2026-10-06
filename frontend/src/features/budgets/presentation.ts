import type { BudgetPeriod, BudgetProgress } from "@/api/budgets";
import { i18n } from "@/i18n";
import { formatMoney, isNegativeMoney, negateMoney } from "@/lib/money";

/** Rotulo do periodo do orcamento, no idioma atual. */
export function periodLabel(period: BudgetPeriod): string {
  return i18n.t(`budgets.presentation.period.${period}`);
}

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
    return i18n.t("budgets.presentation.passedLimit", { amount: formatMoney(negateMoney(item.remaining), item.currency_code) });
  }
  return i18n.t("budgets.presentation.remaining", { amount: formatMoney(item.remaining, item.currency_code) });
}

/** Rotulo do selo de situacao; null quando esta ok (sem selo). */
export function stateLabel(state: ProgressState): string | null {
  if (state === "ok") return null;
  return i18n.t(`budgets.presentation.state.${state}`);
}
