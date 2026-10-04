import type { Envelope, PreviewRow, Template, TemplateKind } from "@/api/envelopes";
import { formatMonthYear } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const KIND_OPTIONS: { value: TemplateKind; label: string; description: string }[] = [
  { value: "fixed", label: "Valor fixo por mês", description: "Distribui o mesmo valor todo mês." },
  { value: "by_date", label: "Juntar até uma data", description: "Divide o que falta pelos meses que restam até a meta." },
  { value: "bill", label: "Ligado a uma conta a pagar", description: "Distribui o valor máximo da conta nos meses em que ela vence." },
  { value: "remainder", label: "O que sobrar", description: "Fica com a sua parte do que sobrou do A orçar, depois dos outros templates." },
];

export function kindLabel(kind: TemplateKind): string {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

/** Frase curta do template, como aparece embaixo do nome do envelope. `billName` so vale no tipo "bill". */
export function templateSummary(template: Template, currencyCode: string, billName?: string): string {
  if (template.kind === "fixed" && template.amount) return `${formatMoney(template.amount, currencyCode)} por mês`;
  if (template.kind === "by_date" && template.amount && template.target_month) {
    return `${formatMoney(template.amount, currencyCode)} até ${formatMonthYear(template.target_month).toLowerCase()}`;
  }
  if (template.kind === "bill") return billName ? `Conta: ${billName}` : "Conta a pagar";
  return "O que sobrar";
}

export type GoalState = NonNullable<Envelope["goal"]>;

/** O selo de meta, sempre com texto (a cor nunca e a unica pista). */
export function goalLabel(goal: GoalState): string {
  if (goal === "met") return "Meta batida";
  if (goal === "partial") return "Falta pouco";
  return "Longe da meta";
}

export type SkipReason = NonNullable<PreviewRow["reason"]>;

const REASONS: Record<SkipReason, string> = {
  already_has: "Já tem valor",
  goal_met: "Meta já atingida",
  date_passed: "A data passou",
  no_due_date: "A conta não vence neste mês",
  no_money_left: "Não sobrou dinheiro",
};

export function reasonLabel(reason: SkipReason): string {
  return REASONS[reason];
}

/** Quantos envelopes a aplicacao vai mudar, em uma frase. */
export function applyCountText(count: number): string {
  if (count === 0) return "Nenhum envelope vai mudar.";
  return count === 1 ? "1 envelope vai mudar." : `${count} envelopes vão mudar.`;
}
