import type { Recurrence, RecurrenceFrequency, RecurrenceStatus } from "@/api/recurrences";
import { i18n } from "@/i18n";
import { daysBetween, formatDate } from "@/lib/dates";
import { formatMoney, placesOf, sumMoney } from "@/lib/money";

/** Rotulo da frequencia, no idioma atual. */
export function frequencyLabel(frequency: RecurrenceFrequency): string {
  return i18n.t(`recurrences.presentation.frequency.${frequency}`);
}

export const FREQUENCIES: RecurrenceFrequency[] = ["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly"];
// So faz sentido pedir o lembrete a cada vencimento, nao a cada dia
export const REMINDER_FREQUENCIES: RecurrenceFrequency[] = ["weekly", "monthly", "quarterly", "half_yearly", "yearly"];

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

/** "1 criada" ou "3 criadas". So no modo automatico. */
export function createdText(count: number): string {
  return i18n.t("recurrences.presentation.created", { count });
}

/** Quando termina: "Sem data final", "Até 31/12/2026" ou "12 vezes (3 criadas)". So no modo automatico. */
export function endText(item: Pick<Recurrence, "end_date" | "max_occurrences" | "created_count">): string {
  if (item.end_date) return i18n.t("recurrences.presentation.until", { date: formatDate(item.end_date) });
  if (item.max_occurrences) {
    return i18n.t("recurrences.presentation.times", {
      count: item.max_occurrences,
      created: createdText(item.created_count),
    });
  }
  return i18n.t("recurrences.presentation.noEndDate");
}

/** Descricao e valor do modelo: "Aluguel · R$ 1.500,00". Dividido: titulo e soma das linhas. So no modo automatico. */
export function templateSummary(template: Recurrence["template"]): string {
  const [first] = template?.splits ?? [];
  if (!first) return "";
  const places = placesOf(first.currency_code);
  const total = sumMoney(
    (template?.splits ?? []).map((split) => String(split.amount)),
    places,
  );
  const title = template?.title?.trim() || first.description;
  return `${title} · ${formatMoney(total, first.currency_code)}`;
}

/** Linha de situacao do proximo lancamento. So no modo automatico. */
export function nextText(item: Pick<Recurrence, "active" | "next_date">, today: string): string {
  // Sem proxima data a recorrente terminou (o servidor so zera next_date quando acaba o fim configurado)
  if (!item.next_date) return i18n.t("recurrences.presentation.ended");
  if (!item.active) return i18n.t("recurrences.presentation.paused");
  const relative = relativeDays(item.next_date, today);
  const date = formatDate(item.next_date);
  return relative
    ? i18n.t("recurrences.presentation.nextWithRelative", { date, relative })
    : i18n.t("recurrences.presentation.next", { date });
}

/** "Próximo vencimento: 05/04/2026 (em 5 dias)". So no modo de lembrete. */
export function nextDueText(item: Pick<RecurrenceStatus, "next_due_date">, today: string): string {
  const relative = relativeDays(item.next_due_date, today);
  const date = formatDate(item.next_due_date);
  return relative
    ? i18n.t("recurrences.presentation.nextDueWithRelative", { date, relative })
    : i18n.t("recurrences.presentation.nextDue", { date });
}

/** "R$ 49,90" quando minimo e maximo sao iguais; senao "R$ 40,00 a R$ 60,00". So no modo de lembrete. */
export function amountRangeText(item: Pick<RecurrenceStatus, "amount_min" | "amount_max" | "currency_code">): string {
  if (item.amount_min === item.amount_max) return formatMoney(item.amount_min ?? "0", item.currency_code ?? "BRL");
  return i18n.t("recurrences.presentation.amountRange", {
    min: formatMoney(item.amount_min ?? "0", item.currency_code ?? "BRL"),
    max: formatMoney(item.amount_max ?? "0", item.currency_code ?? "BRL"),
  });
}

/** Texto do selo de situacao. Nunca depende so da cor. So no modo de lembrete. */
export function statusText(
  item: Pick<RecurrenceStatus, "status" | "last_due_date" | "overdue_count" | "oldest_overdue_date">,
): string {
  if (item.status === "paid") return i18n.t("recurrences.presentation.status.paid");
  if (item.status === "overdue" && item.last_due_date) {
    // Varios vencimentos seguidos sem pagar: mostra quantos e desde quando, nao so o ultimo
    if (item.overdue_count > 1 && item.oldest_overdue_date) {
      return i18n.t("recurrences.presentation.status.overdueMultiple", {
        count: item.overdue_count,
        date: formatDate(item.oldest_overdue_date),
      });
    }
    return i18n.t("recurrences.presentation.status.overdueSingle", { date: formatDate(item.last_due_date) });
  }
  return i18n.t("recurrences.presentation.status.upcoming");
}

/** So no modo de lembrete. */
export function matchText(item: Pick<RecurrenceStatus, "match_text">): string {
  return item.match_text
    ? i18n.t("recurrences.presentation.matchText", { text: item.match_text })
    : i18n.t("recurrences.presentation.noMatchText");
}
