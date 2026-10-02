import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useAccounts } from "@/api/accounts";
import { useBills } from "@/api/bills";
import { useBudgets } from "@/api/budgets";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useCategories, useTags } from "@/api/labels";
import { useCreateRule, useRuleGroups, useUpdateRule, type Rule, type RuleMatchMode } from "@/api/rules";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  MAX_ITEMS,
  TYPE_OPTIONS,
  changesFor,
  defaultValue,
  draftFromRule,
  emptyDraft,
  newAction,
  newTrigger,
  validateDraft,
  type ActionDraft,
  type DraftErrors,
  type RuleDraft,
  type TriggerDraft,
} from "./form-model";
import {
  ACTION_KINDS,
  ACTION_LABELS,
  FIELDS,
  FIELD_LABELS,
  FIELD_OPS,
  MATCH_MODE_LABELS,
  OP_LABELS,
  TYPE_LABELS,
  type ActionKind,
  type TriggerField,
  type TriggerOp,
} from "./presentation";

type Option = { id: string; name: string };

const NO_ERRORS: DraftErrors = { triggers: [], actions: [] };
// Acoes de alvo unico: o tipo que ja esta em outra linha nao aparece de novo
const SINGLE_KINDS: ActionKind[] = ["set_category", "set_budget", "set_bill"];

type Props = {
  // Sem `rule` o dialogo cria; com `rule` edita
  rule?: Rule;
  onClose: () => void;
};

export function RuleFormDialog({ rule, onClose }: Props) {
  const editing = rule !== undefined;
  const create = useCreateRule();
  const update = useUpdateRule();
  const groups = useRuleGroups();
  const accounts = useAccounts({ includeArchived: true });
  const categories = useCategories({ search: "" });
  const tags = useTags({ search: "" });
  const budgets = useBudgets({ activeOnly: false });
  const bills = useBills({ activeOnly: false });

  const [draft, setDraft] = useState<RuleDraft>(() => (rule ? draftFromRule(rule) : emptyDraft()));
  const [errors, setErrors] = useState<DraftErrors>(NO_ERRORS);
  const [formError, setFormError] = useState<string | null>(null);
  const submitting = create.isPending || update.isPending;

  const targets: Record<ActionKind, Option[]> = {
    set_category: categories.data?.items ?? [],
    add_tag: tags.data?.items ?? [],
    set_budget: budgets.data ?? [],
    set_bill: bills.data ?? [],
  };

  const patch = (changes: Partial<RuleDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const patchTrigger = (index: number, changes: Partial<TriggerDraft>) => {
    patch({ triggers: draft.triggers.map((item, i) => (i === index ? { ...item, ...changes } : item)) });
    setErrors((current) => ({ ...current, triggers: current.triggers.map((e, i) => (i === index ? undefined : e)) }));
  };
  const patchAction = (index: number, changes: Partial<ActionDraft>) => {
    patch({ actions: draft.actions.map((item, i) => (i === index ? { ...item, ...changes } : item)) });
    setErrors((current) => ({ ...current, actions: current.actions.map((e, i) => (i === index ? undefined : e)) }));
  };

  function changeField(index: number, field: TriggerField) {
    // Trocar o campo troca as operacoes validas e zera o valor
    patchTrigger(index, { field, op: FIELD_OPS[field][0], value: defaultValue(field) });
  }

  function handleServerError(error: unknown) {
    const message = getErrorMessage(error);
    if (error instanceof ApiError && error.code === "rule_name_taken") {
      setErrors({ ...NO_ERRORS, name: message });
      document.getElementById("rule-name")?.focus();
      return;
    }
    setFormError(message);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const { errors: found, payload } = validateDraft(draft);
    setErrors(found);
    if (!payload) {
      if (found.name) document.getElementById("rule-name")?.focus();
      else if (found.position) document.getElementById("rule-position")?.focus();
      else {
        const trigger = found.triggers.findIndex(Boolean);
        if (trigger >= 0) document.getElementById(`rule-trigger-value-${trigger}`)?.focus();
        else document.getElementById(`rule-action-target-${found.actions.findIndex(Boolean)}`)?.focus();
      }
      return;
    }

    try {
      if (!editing) {
        await create.mutateAsync(payload);
      } else {
        const body = changesFor(rule, payload);
        if (Object.keys(body).length > 0) await update.mutateAsync({ id: rule.id, body });
      }
      onClose();
    } catch (error) {
      handleServerError(error);
    }
  }

  function triggerValueControl(trigger: TriggerDraft, index: number) {
    const id = `rule-trigger-value-${index}`;
    const label = `Valor do gatilho ${index + 1}`;
    const invalid = errors.triggers[index] ? true : undefined;
    if (trigger.field === "account") {
      return (
        <Select id={id} aria-label={label} aria-invalid={invalid} value={trigger.value} onChange={(e) => patchTrigger(index, { value: e.target.value })}>
          <option value="">Escolha a conta</option>
          {(accounts.data ?? []).map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      );
    }
    if (trigger.field === "type") {
      return (
        <Select id={id} aria-label={label} value={trigger.value} onChange={(e) => patchTrigger(index, { value: e.target.value })}>
          {TYPE_OPTIONS.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      );
    }
    return (
      <Input
        id={id}
        aria-label={label}
        aria-invalid={invalid}
        autoComplete="off"
        inputMode={trigger.field === "amount" ? "decimal" : undefined}
        placeholder={trigger.field === "amount" ? "0,00" : "Texto"}
        value={trigger.value}
        onChange={(e) => patchTrigger(index, { value: e.target.value })}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar regra" : "Nova regra"}</DialogTitle>
          <DialogDescription>
            A regra preenche categoria, tags, orçamento ou conta a pagar nas transações que combinam com os gatilhos. Ela
            só preenche o que estiver vazio: o que você escolheu na transação nunca é trocado.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="rule-name" label="Nome" error={errors.name}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={draft.name}
                onChange={(event) => {
                  patch({ name: event.target.value });
                  setErrors((current) => ({ ...current, name: undefined }));
                }}
              />
            )}
          </FormField>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">Quando</legend>
            <FormField id="rule-match-mode" label="Combinação dos gatilhos">
              {(props) => (
                <Select {...props} value={draft.matchMode} onChange={(e) => patch({ matchMode: e.target.value as RuleMatchMode })}>
                  {(Object.keys(MATCH_MODE_LABELS) as RuleMatchMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {MATCH_MODE_LABELS[mode]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            {draft.triggers.map((trigger, index) => (
              <div key={index} className="flex flex-col gap-1">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
                  <Select
                    aria-label={`Campo do gatilho ${index + 1}`}
                    value={trigger.field}
                    onChange={(e) => changeField(index, e.target.value as TriggerField)}
                  >
                    {FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {FIELD_LABELS[field]}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label={`Operação do gatilho ${index + 1}`}
                    value={trigger.op}
                    onChange={(e) => patchTrigger(index, { op: e.target.value as TriggerOp })}
                  >
                    {FIELD_OPS[trigger.field].map((op) => (
                      <option key={op} value={op}>
                        {OP_LABELS[op]}
                      </option>
                    ))}
                  </Select>
                  {triggerValueControl(trigger, index)}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover gatilho ${index + 1}`}
                    disabled={draft.triggers.length === 1}
                    onClick={() => {
                      patch({ triggers: draft.triggers.filter((_, i) => i !== index) });
                      setErrors((current) => ({ ...current, triggers: current.triggers.filter((_, i) => i !== index) }));
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {errors.triggers[index] && (
                  <p role="alert" className="text-sm text-destructive">
                    {errors.triggers[index]}
                  </p>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={draft.triggers.length >= MAX_ITEMS}
              onClick={() => patch({ triggers: [...draft.triggers, newTrigger()] })}
            >
              <Plus />
              Adicionar gatilho
            </Button>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">Então</legend>
            {draft.actions.map((action, index) => {
              const usedElsewhere = new Set(
                draft.actions.filter((_, i) => i !== index).map((other) => other.kind),
              );
              return (
                <div key={index} className="flex flex-col gap-1">
                  <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
                    <Select
                      aria-label={`Ação ${index + 1}`}
                      value={action.kind}
                      onChange={(e) => patchAction(index, { kind: e.target.value as ActionKind, targetId: "" })}
                    >
                      {ACTION_KINDS.map((kind) => (
                        <option key={kind} value={kind} disabled={SINGLE_KINDS.includes(kind) && usedElsewhere.has(kind)}>
                          {ACTION_LABELS[kind]}
                        </option>
                      ))}
                    </Select>
                    <Select
                      id={`rule-action-target-${index}`}
                      aria-label={`Alvo da ação ${index + 1}`}
                      aria-invalid={errors.actions[index] ? true : undefined}
                      value={action.targetId}
                      onChange={(e) => patchAction(index, { targetId: e.target.value })}
                    >
                      <option value="">Escolha</option>
                      {targets[action.kind].map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ação ${index + 1}`}
                      disabled={draft.actions.length === 1}
                      onClick={() => {
                        patch({ actions: draft.actions.filter((_, i) => i !== index) });
                        setErrors((current) => ({ ...current, actions: current.actions.filter((_, i) => i !== index) }));
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {errors.actions[index] && (
                    <p role="alert" className="text-sm text-destructive">
                      {errors.actions[index]}
                    </p>
                  )}
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={draft.actions.length >= MAX_ITEMS}
              onClick={() => patch({ actions: [...draft.actions, newAction(draft.actions)] })}
            >
              <Plus />
              Adicionar ação
            </Button>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="rule-group" label="Grupo">
              {(props) => (
                <Select {...props} value={draft.groupId} onChange={(e) => patch({ groupId: e.target.value })}>
                  <option value="">Sem grupo</option>
                  {(groups.data ?? []).map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField id="rule-position" label="Ordem" error={errors.position}>
              {(props) => (
                <Input
                  {...props}
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.position}
                  onChange={(event) => {
                    patch({ position: event.target.value });
                    setErrors((current) => ({ ...current, position: undefined }));
                  }}
                />
              )}
            </FormField>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.stopProcessing}
                onChange={(event) => patch({ stopProcessing: event.target.checked })}
                className="accent-[var(--primary)]"
              />
              Parar aqui: se esta regra valer, as seguintes não rodam
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => patch({ active: event.target.checked })}
                className="accent-[var(--primary)]"
              />
              Regra ativa
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Salvando..." : editing ? "Salvar" : "Criar regra"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
