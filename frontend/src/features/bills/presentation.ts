import type { BillFrequency, BillStatus } from "@/api/bills";
import { i18n } from "@/i18n";
import { daysBetween, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

/** Rotulo da frequencia da conta a pagar, no idioma atual. */
export function frequencyLabel(frequency: BillFrequency): string {
  return i18n.t(`bills.presentation.frequency.${frequency}`);
}

export const FREQUENCIES: BillFrequency[] = ["weekly", "monthly", "quarterly", "half_yearly", "yearly"];

// Ate quantos dias a frase diz "em N dias"; depois disso so a data
const RELATIVE_UNTIL_DAYS = 30;

/** "hoje", "amanha", "em 5 dias" ou null (passado ou longe demais). */
export function relativeDays(date: string, today: string): string | null {
  const days = daysBetween(today, date);
  if (days < 0 || days > RELATIVE_UNTIL_DAYS) return null;
  if (days === 0) return i18n.t("common.relativeDays.today");
  if (days === 1) return i18n.t("common.relativeDays.tomorrow");
  return i18n.t("common.relativeDays.inDays", { count: days });
}

/** "Próximo vencimento: 05/04/2026 (em 5 dias)". */
export function nextDueText(item: Pick<BillStatus, "next_due_date">, today: string): string {
  const relative = relativeDays(item.next_due_date, today);
  const date = formatDate(item.next_due_date);
  return relative ? i18n.t("bills.presentation.nextDueWithRelative", { date, relative }) : i18n.t("bills.presentation.nextDue", { date });
}

/** "R$ 49,90" quando minimo e maximo sao iguais; senao "R$ 40,00 a R$ 60,00". */
export function amountRangeText(item: Pick<BillStatus, "amount_min" | "amount_max" | "currency_code">): string {
  if (item.amount_min === item.amount_max) return formatMoney(item.amount_min, item.currency_code);
  return i18n.t("bills.presentation.amountRange", {
    min: formatMoney(item.amount_min, item.currency_code),
    max: formatMoney(item.amount_max, item.currency_code),
  });
}

/** Texto do selo de situacao. Nunca depende so da cor. */
export function statusText(
  item: Pick<BillStatus, "status" | "last_due_date" | "overdue_count" | "oldest_overdue_date">,
): string {
  if (item.status === "paid") return i18n.t("bills.presentation.status.paid");
  if (item.status === "overdue" && item.last_due_date) {
    // Varios vencimentos seguidos sem pagar: mostra quantos e desde quando, nao so o ultimo
    if (item.overdue_count > 1 && item.oldest_overdue_date) {
      return i18n.t("bills.presentation.status.overdueMultiple", {
        count: item.overdue_count,
        date: formatDate(item.oldest_overdue_date),
      });
    }
    return i18n.t("bills.presentation.status.overdueSingle", { date: formatDate(item.last_due_date) });
  }
  return i18n.t("bills.presentation.status.upcoming");
}

export function matchText(item: Pick<BillStatus, "match_text">): string {
  return item.match_text
    ? i18n.t("bills.presentation.matchText", { text: item.match_text })
    : i18n.t("bills.presentation.noMatchText");
}
