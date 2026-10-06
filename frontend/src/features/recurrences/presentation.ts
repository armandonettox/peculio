import type { Recurrence, RecurrenceFrequency } from "@/api/recurrences";
import { i18n } from "@/i18n";
import { daysBetween, formatDate } from "@/lib/dates";
import { formatMoney, placesOf, sumMoney } from "@/lib/money";

/** Rotulo da frequencia da recorrente, no idioma atual. */
export function frequencyLabel(frequency: RecurrenceFrequency): string {
  return i18n.t(`recurrences.presentation.frequency.${frequency}`);
}

export const FREQUENCIES: RecurrenceFrequency[] = ["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly"];

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

/** "1 criada" ou "3 criadas". */
export function createdText(count: number): string {
  return i18n.t("recurrences.presentation.created", { count });
}

/** Quando termina: "Sem data final", "Até 31/12/2026" ou "12 vezes (3 criadas)". */
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

/** Descricao e valor do modelo: "Aluguel · R$ 1.500,00". Dividido: titulo e soma das linhas. */
export function templateSummary(template: Recurrence["template"]): string {
  const [first] = template.splits;
  if (!first) return "";
  const places = placesOf(first.currency_code);
  const total = sumMoney(
    template.splits.map((split) => String(split.amount)),
    places,
  );
  const title = template.title?.trim() || first.description;
  return `${title} · ${formatMoney(total, first.currency_code)}`;
}

/** Linha de situacao do proximo lancamento. */
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
