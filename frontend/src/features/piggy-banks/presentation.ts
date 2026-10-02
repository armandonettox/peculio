import type { PiggyBank } from "@/api/piggy-banks";
import { formatDate } from "@/lib/dates";
import { formatMoney, isNegativeMoney, negateMoney } from "@/lib/money";

/** A meta foi atingida (ou passou dela). */
export const isReached = (piggy: Pick<PiggyBank, "percent">) => piggy.percent >= 100;

/** "Faltam R$ 450,00" ou "Meta atingida". */
export function remainingText(piggy: Pick<PiggyBank, "percent" | "remaining" | "currency_code">): string {
  if (isReached(piggy)) return "Meta atingida";
  return `Faltam ${formatMoney(piggy.remaining, piggy.currency_code)}`;
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
  if (isReached(piggy)) return `Até ${date}`;
  if (piggy.target_date < today) return `A data alvo passou (${date})`;
  if (piggy.suggested_per_month) {
    return `Até ${date} · guarde ${formatMoney(piggy.suggested_per_month, piggy.currency_code)} por mês`;
  }
  return `Até ${date}`;
}

/** Quanto da conta ainda esta livre; avisa quando o saldo caiu abaixo do reservado. */
export function availableText(piggy: Pick<PiggyBank, "account_name" | "account_available" | "currency_code">): {
  text: string;
  warning: boolean;
} {
  if (isNegativeMoney(piggy.account_available)) {
    return {
      text: `O saldo de ${piggy.account_name} está ${formatMoney(negateMoney(piggy.account_available), piggy.currency_code)} abaixo do que está guardado em cofrinhos`,
      warning: true,
    };
  }
  return {
    text: `Disponível em ${piggy.account_name}: ${formatMoney(piggy.account_available, piggy.currency_code)}`,
    warning: false,
  };
}
