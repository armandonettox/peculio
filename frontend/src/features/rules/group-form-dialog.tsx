import { useState, type FormEvent } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useCreateRuleGroup, useUpdateRuleGroup, type RuleGroup } from "@/api/rules";
import { requiredError } from "@/auth/validation";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MAX_POSITION, parsePosition } from "./form-model";

type Field = "name" | "position";
type Errors = Partial<Record<Field, string>>;

type Props = {
  // Sem `group` o dialogo cria; com `group` edita
  group?: RuleGroup;
  onClose: () => void;
};

export function GroupFormDialog({ group, onClose }: Props) {
  const editing = group !== undefined;
  const create = useCreateRuleGroup();
  const update = useUpdateRuleGroup();
  const [name, setName] = useState(group?.name ?? "");
  const [position, setPosition] = useState(String(group?.position ?? 0));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const submitting = create.isPending || update.isPending;

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function handleServerError(error: unknown) {
    const message = getErrorMessage(error);
    if (error instanceof ApiError && error.code === "rule_group_name_taken") {
      setErrors({ name: message });
      document.getElementById("rule-group-name")?.focus();
      return;
    }
    setFormError(message);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found: Errors = { name: requiredError(name, "Informe o nome do grupo.") };
    const parsed = parsePosition(position);
    if (parsed === null) found.position = `Informe um número inteiro de 0 a ${MAX_POSITION}.`;
    setErrors(found);
    const firstInvalid = (["name", "position"] as const).find((field) => found[field]);
    if (firstInvalid || parsed === null) {
      if (firstInvalid) document.getElementById(`rule-group-${firstInvalid}`)?.focus();
      return;
    }

    try {
      if (!editing) {
        await create.mutateAsync({ name: name.trim(), position: parsed });
      } else {
        // Manda so o que mudou
        const body: { name?: string; position?: number } = {};
        if (name.trim() !== group.name) body.name = name.trim();
        if (parsed !== group.position) body.position = parsed;
        if (Object.keys(body).length > 0) await update.mutateAsync({ id: group.id, body });
      }
      onClose();
    } catch (error) {
      handleServerError(error);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar grupo" : "Novo grupo"}</DialogTitle>
          <DialogDescription>
            Grupos ajudam a organizar as regras. Eles rodam em ordem: o de número menor vem primeiro, e as regras sem
            grupo rodam por último.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="rule-group-name" label="Nome" error={errors.name}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  clearError("name");
                }}
              />
            )}
          </FormField>

          <FormField id="rule-group-position" label="Ordem" error={errors.position}>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                autoComplete="off"
                value={position}
                onChange={(event) => {
                  setPosition(event.target.value);
                  clearError("position");
                }}
              />
            )}
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Salvando..." : editing ? "Salvar" : "Criar grupo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
