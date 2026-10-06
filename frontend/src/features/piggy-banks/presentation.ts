import type { PiggyBank } from "@/api/piggy-banks";
import { i18n } from "@/i18n";
import { formatDate } from "@/lib/dates";
import { formatMoney, isNegativeMoney, negateMoney } from "@/lib/money";

/** A meta foi atingida (ou passou dela). */
export const isReached = (piggy: Pick<PiggyBank, "percent">) => piggy.percent >= 100;

/** "Faltam R$ 450,00" ou "Meta atingida". */
export function remainingText(piggy: Pick<PiggyBank, "percent" | "remaining" | "currency_code">): string {
  if (isReached(piggy)) return i18n.t("piggy-banks.presentation.metaAtingida");
  return i18n.t("piggy-banks.presentation.faltam", { amount: formatMoney(piggy.remaining, piggy.currency_code) });
}

/**
 * Linha da data alvo: "Até 31/12/2026 · guarde R$ 100,00 por mês", "Até 31/12/2026" quando ja deu,
 * "A data alvo passou (31/12/2025)" quando passou sem chegar a meta. Vazio sem data.
 */
export function targetText(
  piggy: Pick<PiggyBank, "target_date" | "suggested_per_month" | "currency_code" | "percent">,
  today: string,
): string | null {
  if (!piggy.target_date) return null;
  const date = formatDate(piggy.target_date);
  if (isReached(piggy)) return i18n.t("piggy-banks.presentation.target.reached", { date });
  if (piggy.target_date < today) return i18n.t("piggy-banks.presentation.target.passed", { date });
  if (piggy.suggested_per_month) {
    return i18n.t("piggy-banks.presentation.target.withSuggestion", {
      date,
      amount: formatMoney(piggy.suggested_per_month, piggy.currency_code),
    });
  }
  return i18n.t("piggy-banks.presentation.target.reached", { date });
}

/** Quanto da conta ainda esta livre; avisa quando o saldo caiu abaixo do reservado. */
export function availableText(piggy: Pick<PiggyBank, "account_name" | "account_available" | "currency_code">): {
  text: string;
  warning: boolean;
} {
  if (isNegativeMoney(piggy.account_available)) {
    return {
      text: i18n.t("piggy-banks.presentation.available.warning", {
        account: piggy.account_name,
        amount: formatMoney(negateMoney(piggy.account_available), piggy.currency_code),
      }),
      warning: true,
    };
  }
  return {
    text: i18n.t("piggy-banks.presentation.available.ok", {
      account: piggy.account_name,
      amount: formatMoney(piggy.account_available, piggy.currency_code),
    }),
    warning: false,
  };
}
