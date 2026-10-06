import { i18n } from "@/i18n";
import type { RuleAction, RuleMatchMode, RuleTrigger } from "@/api/rules";

export type TriggerField = RuleTrigger["field"];
export type TriggerOp = RuleTrigger["op"];
export type ActionKind = RuleAction["kind"];

export const FIELDS: TriggerField[] = ["description", "counterparty", "amount", "account", "type"];

export function fieldLabel(field: TriggerField): string {
  return i18n.t(`rules.presentation.field.${field}`);
}

// Operacoes de cada campo, na mesma regra do backend
export const FIELD_OPS: Record<TriggerField, TriggerOp[]> = {
  description: ["contains", "starts_with", "equals"],
  counterparty: ["contains", "starts_with", "equals"],
  amount: ["greater_than", "less_than", "equals"],
  account: ["is"],
  type: ["is"],
};

export function opLabel(op: TriggerOp): string {
  return i18n.t(`rules.presentation.op.${op}`);
}

export function typeLabel(type: string): string | undefined {
  switch (type) {
    case "withdrawal":
      return i18n.t("rules.presentation.type.withdrawal");
    case "deposit":
      return i18n.t("rules.presentation.type.deposit");
    case "transfer":
      return i18n.t("rules.presentation.type.transfer");
    default:
      return undefined;
  }
}

export const ACTION_KINDS: ActionKind[] = ["set_category", "add_tag", "set_budget", "set_bill"];

export function actionLabel(kind: ActionKind): string {
  return i18n.t(`rules.presentation.action.${kind}`);
}

// Rotulo curto do resumo na lista ("Categoria: Mercado")
function actionSummaryLabel(kind: ActionKind): string {
  return i18n.t(`rules.presentation.actionSummary.${kind}`);
}

export function matchModeLabel(mode: RuleMatchMode): string {
  return i18n.t(`rules.presentation.matchMode.${mode}`);
}

/** Nomes por id, para escrever o resumo da regra sem buscar nada de novo. */
export type NameLookups = {
  accounts: Map<string, string>;
  categories: Map<string, string>;
  tags: Map<string, string>;
  budgets: Map<string, string>;
  bills: Map<string, string>;
};

export function triggerSummary(trigger: RuleTrigger, lookups: NameLookups): string {
  const field = fieldLabel(trigger.field);
  const op = opLabel(trigger.op);
  const removed = i18n.t("rules.presentation.itemRemovido");
  if (trigger.field === "account") return `${field} ${op} ${lookups.accounts.get(trigger.value) ?? removed}`;
  if (trigger.field === "type") return `${field} ${op} ${typeLabel(trigger.value) ?? trigger.value}`;
  if (trigger.field === "amount") return `${field} ${op} ${trigger.value.replace(".", ",")}`;
  return `${field} ${op} "${trigger.value}"`;
}

export function actionSummary(action: RuleAction, lookups: NameLookups): string {
  const source = {
    set_category: lookups.categories,
    add_tag: lookups.tags,
    set_budget: lookups.budgets,
    set_bill: lookups.bills,
  }[action.kind];
  const removed = i18n.t("rules.presentation.itemRemovido");
  return `${actionSummaryLabel(action.kind)}: ${source.get(action.target_id) ?? removed}`;
}

type PreviewChanges = {
  category_id: string | null;
  budget_id: string | null;
  bill_id: string | null;
  add_tag_ids: string[];
};

/** O que a regra preencheria num lancamento antigo, uma linha por campo ("Categoria: Mercado"). */
export function previewChanges(item: PreviewChanges, lookups: NameLookups): string[] {
  const lines: string[] = [];
  if (item.category_id) lines.push(actionSummary({ kind: "set_category", target_id: item.category_id }, lookups));
  if (item.budget_id) lines.push(actionSummary({ kind: "set_budget", target_id: item.budget_id }, lookups));
  if (item.bill_id) lines.push(actionSummary({ kind: "set_bill", target_id: item.bill_id }, lookups));
  for (const tagId of item.add_tag_ids) lines.push(actionSummary({ kind: "add_tag", target_id: tagId }, lookups));
  return lines;
}
