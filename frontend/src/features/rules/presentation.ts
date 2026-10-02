import type { RuleAction, RuleMatchMode, RuleTrigger } from "@/api/rules";

export type TriggerField = RuleTrigger["field"];
export type TriggerOp = RuleTrigger["op"];
export type ActionKind = RuleAction["kind"];

export const FIELDS: TriggerField[] = ["description", "counterparty", "amount", "account", "type"];

export const FIELD_LABELS: Record<TriggerField, string> = {
  description: "Descrição",
  counterparty: "Quem recebeu ou pagou",
  amount: "Valor",
  account: "Conta",
  type: "Tipo",
};

// Operacoes de cada campo, na mesma regra do backend
export const FIELD_OPS: Record<TriggerField, TriggerOp[]> = {
  description: ["contains", "starts_with", "equals"],
  counterparty: ["contains", "starts_with", "equals"],
  amount: ["greater_than", "less_than", "equals"],
  account: ["is"],
  type: ["is"],
};

export const OP_LABELS: Record<TriggerOp, string> = {
  contains: "contém",
  starts_with: "começa com",
  equals: "é igual a",
  greater_than: "é maior que",
  less_than: "é menor que",
  is: "é",
};

export const TYPE_LABELS: Record<string, string> = {
  withdrawal: "Saída",
  deposit: "Entrada",
  transfer: "Transferência",
};

export const ACTION_KINDS: ActionKind[] = ["set_category", "add_tag", "set_budget", "set_bill"];

export const ACTION_LABELS: Record<ActionKind, string> = {
  set_category: "Definir categoria",
  add_tag: "Adicionar tag",
  set_budget: "Ligar ao orçamento",
  set_bill: "Ligar à conta a pagar",
};

// Rotulo curto do resumo na lista ("Categoria: Mercado")
const ACTION_SUMMARY_LABELS: Record<ActionKind, string> = {
  set_category: "Categoria",
  add_tag: "Tag",
  set_budget: "Orçamento",
  set_bill: "Conta a pagar",
};

export const MATCH_MODE_LABELS: Record<RuleMatchMode, string> = {
  all: "Todos os gatilhos precisam valer",
  any: "Basta um gatilho valer",
};

/** Nomes por id, para escrever o resumo da regra sem buscar nada de novo. */
export type NameLookups = {
  accounts: Map<string, string>;
  categories: Map<string, string>;
  tags: Map<string, string>;
  budgets: Map<string, string>;
  bills: Map<string, string>;
};

const REMOVED = "item removido";

export function triggerSummary(trigger: RuleTrigger, lookups: NameLookups): string {
  const field = FIELD_LABELS[trigger.field];
  const op = OP_LABELS[trigger.op];
  if (trigger.field === "account") return `${field} ${op} ${lookups.accounts.get(trigger.value) ?? REMOVED}`;
  if (trigger.field === "type") return `${field} ${op} ${TYPE_LABELS[trigger.value] ?? trigger.value}`;
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
  return `${ACTION_SUMMARY_LABELS[action.kind]}: ${source.get(action.target_id) ?? REMOVED}`;
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
