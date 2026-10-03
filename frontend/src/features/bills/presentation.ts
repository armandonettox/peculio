import type { BillFrequency, BillStatus } from "@/api/bills";
import { daysBetween, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const FREQUENCY_LABELS: Record<BillFrequency, string> = {
  weekly: "Semanal",
  monthly: "Mensal",
  quarterly: "Trimestral",
  half_yearly: "Semestral",
  yearly: "Anual",
};

export const FREQUENCIES: BillFrequency[] = ["weekly", "monthly", "quarterly", "half_yearly", "yearly"];

// Ate quantos dias a frase diz "em N dias"; depois disso so a data
const RELATIVE_UNTIL_DAYS = 30;

/** "hoje", "amanha", "em 5 dias" ou null (passado ou longe demais). */
export function relativeDays(date: string, today: string): string | null {
  const days = daysBetween(today, date);
  if (days < 0 || days > RELATIVE_UNTIL_DAYS) return null;
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  return `em ${days} dias`;
}

/** "Próximo vencimento: 05/04/2026 (em 5 dias)". */
export function nextDueText(item: Pick<BillStatus, "next_due_date">, today: string): string {
  const relative = relativeDays(item.next_due_date, today);
  return `Próximo vencimento: ${formatDate(item.next_due_date)}${relative ? ` (${relative})` : ""}`;
}

/** "R$ 49,90" quando minimo e maximo sao iguais; senao "R$ 40,00 a R$ 60,00". */
export function amountRangeText(item: Pick<BillStatus, "amount_min" | "amount_max" | "currency_code">): string {
  if (item.amount_min === item.amount_max) return formatMoney(item.amount_min, item.currency_code);
  return `${formatMoney(item.amount_min, item.currency_code)} a ${formatMoney(item.amount_max, item.currency_code)}`;
}

/** Texto do selo de situacao. Nunca depende so da cor. */
export function statusText(
  item: Pick<BillStatus, "status" | "last_due_date" | "overdue_count" | "oldest_overdue_date">,
): string {
  if (item.status === "paid") return "Pago";
  if (item.status === "overdue" && item.last_due_date) {
    // Varios vencimentos seguidos sem pagar: mostra quantos e desde quando, nao so o ultimo
    if (item.overdue_count > 1 && item.oldest_overdue_date) {
      return `Atrasada · ${item.overdue_count} vencimentos atrasados, o mais antigo em ${formatDate(item.oldest_overdue_date)}`;
    }
    return `Atrasada · venceu em ${formatDate(item.last_due_date)}`;
  }
  return "A vencer";
}

export function matchText(item: Pick<BillStatus, "match_text">): string {
  return item.match_text ? `Liga sozinha quando contém “${item.match_text}”` : "Sem ligação automática";
}
