import type { Rule, RuleCreate, RuleMatchMode, RuleUpdate } from "@/api/rules";
import { parseMoneyInput } from "@/lib/money";
import { FIELD_OPS, type ActionKind, type TriggerField, type TriggerOp } from "./presentation";

export const MAX_ITEMS = 10;
export const AMOUNT_PLACES = 2;
export const MAX_POSITION = 100000;

/** Ordem digitada -> numero. null se nao for um inteiro de 0 a 100000. */
export function parsePosition(text: string): number | null {
  const clean = text.trim();
  if (!/^\d+$/.test(clean)) return null;
  const value = Number(clean);
  return value <= MAX_POSITION ? value : null;
}

export type TriggerDraft = { field: TriggerField; op: TriggerOp; value: string };
export type ActionDraft = { kind: ActionKind; targetId: string };

export type RuleDraft = {
  name: string;
  groupId: string;
  position: string;
  matchMode: RuleMatchMode;
  stopProcessing: boolean;
  active: boolean;
  triggers: TriggerDraft[];
  actions: ActionDraft[];
};

export type DraftErrors = {
  name?: string;
  position?: string;
  triggers: (string | undefined)[];
  actions: (string | undefined)[];
};

// Acoes que aceitam um alvo so por regra; tags podem ser varias
const SINGLE_KINDS: ActionKind[] = ["set_category", "set_budget", "set_bill"];

export const TYPE_OPTIONS = ["withdrawal", "deposit", "transfer"] as const;

/** Valor inicial de um gatilho novo do campo: o tipo ja vem escolhido, os demais comecam vazios. */
export function defaultValue(field: TriggerField): string {
  return field === "type" ? TYPE_OPTIONS[0] : "";
}

export function newTrigger(field: TriggerField = "description"): TriggerDraft {
  return { field, op: FIELD_OPS[field][0], value: defaultValue(field) };
}

/** Primeira acao que ainda pode ser adicionada: as de alvo unico ja usadas ficam de fora. */
export function newAction(used: ActionDraft[] = []): ActionDraft {
  const taken = new Set(used.map((action) => action.kind));
  const kind = SINGLE_KINDS.find((candidate) => !taken.has(candidate)) ?? "add_tag";
  return { kind, targetId: "" };
}

export function emptyDraft(): RuleDraft {
  return {
    name: "",
    groupId: "",
    position: "0",
    matchMode: "all",
    stopProcessing: false,
    active: true,
    triggers: [newTrigger()],
    actions: [newAction()],
  };
}

export function draftFromRule(rule: Rule): RuleDraft {
  return {
    name: rule.name,
    groupId: rule.group_id ?? "",
    position: String(rule.position),
    matchMode: rule.match_mode,
    stopProcessing: rule.stop_processing,
    active: rule.active,
    // Na tela o valor usa virgula; o backend guarda com ponto
    triggers: rule.triggers.map((trigger) => ({
      field: trigger.field,
      op: trigger.op,
      value: trigger.field === "amount" ? trigger.value.replace(".", ",") : trigger.value,
    })),
    actions: rule.actions.map((action) => ({ kind: action.kind, targetId: action.target_id })),
  };
}

const TARGET_REQUIRED: Record<ActionKind, string> = {
  set_category: "Escolha a categoria.",
  add_tag: "Escolha a tag.",
  set_budget: "Escolha o orçamento.",
  set_bill: "Escolha a conta a pagar.",
};

function triggerError(trigger: TriggerDraft): string | undefined {
  if (trigger.field === "account") return trigger.value ? undefined : "Escolha uma conta.";
  if (trigger.field === "type") return undefined;
  if (trigger.field === "amount") {
    const parsed = parseMoneyInput(trigger.value, AMOUNT_PLACES);
    if (!parsed.ok) return parsed.error;
    return parsed.value.startsWith("-") ? "O valor não pode ser negativo." : undefined;
  }
  return trigger.value.trim() ? undefined : "Informe o texto.";
}

function triggerValue(trigger: TriggerDraft): string {
  if (trigger.field === "amount") {
    const parsed = parseMoneyInput(trigger.value, AMOUNT_PLACES);
    return parsed.ok ? parsed.value : trigger.value;
  }
  if (trigger.field === "description" || trigger.field === "counterparty") return trigger.value.trim();
  return trigger.value;
}

export function actionErrors(actions: ActionDraft[]): (string | undefined)[] {
  const seenKinds = new Set<ActionKind>();
  const seenTags = new Set<string>();
  return actions.map((action) => {
    if (!action.targetId) return TARGET_REQUIRED[action.kind];
    if (SINGLE_KINDS.includes(action.kind)) {
      if (seenKinds.has(action.kind)) return "Só pode haver uma ação desse tipo.";
      seenKinds.add(action.kind);
    } else {
      if (seenTags.has(action.targetId)) return "Essa tag já foi escolhida.";
      seenTags.add(action.targetId);
    }
    return undefined;
  });
}

export type RulePayload = RuleCreate;

export function validateDraft(draft: RuleDraft): { errors: DraftErrors; payload: RulePayload | null } {
  const position = parsePosition(draft.position);
  const errors: DraftErrors = {
    name: draft.name.trim() ? undefined : "Informe o nome da regra.",
    position: position === null ? "Informe um número inteiro de 0 a 100000." : undefined,
    triggers: draft.triggers.map(triggerError),
    actions: actionErrors(draft.actions),
  };
  const invalid =
    errors.name !== undefined ||
    errors.position !== undefined ||
    errors.triggers.some((error) => error !== undefined) ||
    errors.actions.some((error) => error !== undefined);
  if (invalid || position === null) return { errors, payload: null };

  return {
    errors,
    payload: {
      name: draft.name.trim(),
      group_id: draft.groupId || null,
      position,
      match_mode: draft.matchMode,
      stop_processing: draft.stopProcessing,
      active: draft.active,
      triggers: draft.triggers.map((trigger) => ({
        field: trigger.field,
        op: trigger.op,
        value: triggerValue(trigger),
      })),
      actions: draft.actions.map((action) => ({ kind: action.kind, target_id: action.targetId })),
    },
  };
}

/** So o que mudou em relacao a regra salva, para nao sobrescrever sem querer. */
export function changesFor(rule: Rule, payload: RulePayload): RuleUpdate {
  const body: RuleUpdate = {};
  if (payload.name !== rule.name) body.name = payload.name;
  if ((payload.group_id ?? null) !== rule.group_id) body.group_id = payload.group_id ?? null;
  if (payload.position !== rule.position) body.position = payload.position;
  if (payload.match_mode !== rule.match_mode) body.match_mode = payload.match_mode;
  if (payload.stop_processing !== rule.stop_processing) body.stop_processing = payload.stop_processing;
  if (payload.active !== rule.active) body.active = payload.active;
  if (JSON.stringify(payload.triggers) !== JSON.stringify(rule.triggers)) body.triggers = payload.triggers;
  if (JSON.stringify(payload.actions) !== JSON.stringify(rule.actions)) body.actions = payload.actions;
  return body;
}
