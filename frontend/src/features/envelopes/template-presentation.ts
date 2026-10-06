import type { Envelope, PreviewRow, Template, TemplateKind } from "@/api/envelopes";
import { i18n } from "@/i18n";
import { formatMonthYear } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

const KIND_VALUES: TemplateKind[] = ["fixed", "by_date", "bill", "remainder"];

export function kindOptions(): { value: TemplateKind; label: string; description: string }[] {
  return KIND_VALUES.map((value) => ({
    value,
    label: i18n.t(`envelopes.templatePresentation.kind.${value}.label`),
    description: i18n.t(`envelopes.templatePresentation.kind.${value}.description`),
  }));
}

export function kindLabel(kind: TemplateKind): string {
  return i18n.t(`envelopes.templatePresentation.kind.${kind}.label`);
}

/** Frase curta do template, como aparece embaixo do nome do envelope. `billName` so vale no tipo "bill". */
export function templateSummary(template: Template, currencyCode: string, billName?: string): string {
  if (template.kind === "fixed" && template.amount) {
    return i18n.t("envelopes.templatePresentation.summary.fixed", { amount: formatMoney(template.amount, currencyCode) });
  }
  if (template.kind === "by_date" && template.amount && template.target_month) {
    return i18n.t("envelopes.templatePresentation.summary.byDate", {
      amount: formatMoney(template.amount, currencyCode),
      month: formatMonthYear(template.target_month).toLowerCase(),
    });
  }
  if (template.kind === "bill") {
    return billName
      ? i18n.t("envelopes.templatePresentation.summary.billNamed", { name: billName })
      : i18n.t("envelopes.templatePresentation.summary.billPlain");
  }
  return i18n.t("envelopes.templatePresentation.summary.remainder");
}

export type GoalState = NonNullable<Envelope["goal"]>;

/** O selo de meta, sempre com texto (a cor nunca e a unica pista). */
export function goalLabel(goal: GoalState): string {
  return i18n.t(`envelopes.templatePresentation.goal.${goal}`);
}

export type SkipReason = NonNullable<PreviewRow["reason"]>;

export function reasonLabel(reason: SkipReason): string {
  return i18n.t(`envelopes.templatePresentation.reason.${reason}`);
}

/** Quantos envelopes a aplicacao vai mudar, em uma frase. */
export function applyCountText(count: number): string {
  return i18n.t("envelopes.templatePresentation.applyCount", { count });
}
