import { useState, type FormEvent } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { requiredError } from "@/auth/validation";
import { ColorPicker } from "@/components/color-picker";
import { FormField } from "@/components/form-field";
import { LabelChip } from "@/components/label-chip";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { colorError, normalizeHex } from "@/lib/color";

export type LabelValues = { name: string; color: string | null };

type Props = {
  title: string;
  description: string;
  initial: LabelValues;
  withColor: boolean;
  nameMaxLength: number;
  // Codigo de erro do servidor para "nome repetido" (category_name_taken ou tag_name_taken)
  takenCode: string;
  submitLabel: string;
  onSubmit: (values: LabelValues) => Promise<unknown>;
  onClose: () => void;
};

type Field = "name" | "color";

export function LabelFormDialog({
  title,
  description,
  initial,
  withColor,
  nameMaxLength,
  takenCode,
  submitLabel,
  onSubmit,
  onClose,
}: Props) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color ?? "");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function focusField(field: Field) {
    document.getElementById(`label-${field}`)?.focus();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found: Partial<Record<Field, string>> = {
      name: requiredError(name, "Informe o nome."),
      ...(withColor ? { color: colorError(color) } : {}),
    };
    setErrors(found);
    const first = (["name", "color"] as const).find((field) => found[field]);
    if (first) return focusField(first);

    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), color: withColor ? normalizeHex(color) : null });
      onClose();
    } catch (error) {
      setSubmitting(false);
      const message = getErrorMessage(error);
      if (error instanceof ApiError) {
        const serverErrors: Partial<Record<Field, string>> = {};
        for (const item of error.fieldErrors) {
          if (item.field === "name" || item.field === "color") serverErrors[item.field] = item.message;
        }
        if (error.code === takenCode) serverErrors.name = message;
        const field = (["name", "color"] as const).find((f) => serverErrors[f]);
        if (field) {
          setErrors(serverErrors);
          focusField(field);
          if (error.code === "validation_error") setFormError(message);
          return;
        }
      }
      setFormError(message);
    }
  }

  const previewColor = withColor ? normalizeHex(color) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="label-name" label="Nome" error={errors.name}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                maxLength={nameMaxLength}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  clearError("name");
                }}
              />
            )}
          </FormField>

          {withColor && (
            <FormField id="label-color" label="Cor" error={errors.color} hint="Escolha qualquer cor ou deixe sem cor.">
              {(props) => (
                <ColorPicker
                  {...props}
                  value={color}
                  onChange={(value) => {
                    setColor(value);
                    clearError("color");
                  }}
                />
              )}
            </FormField>
          )}

          {withColor && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              Como vai aparecer:
              <LabelChip name={name.trim() || "Nome da categoria"} color={previewColor} />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Salvando..." : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
