import { useEffect, useState, type FormEvent } from "react";

import { useChangePassword } from "@/api/account";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { FormField } from "@/components/form-field";
import { PasswordInput } from "@/components/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { passwordFormErrors, type PasswordErrors } from "./model";

type Field = "current" | "next" | "confirm";
const IDS: Record<Field, string> = { current: "settings-password-current", next: "settings-password-new", confirm: "settings-password-confirm" };

/** Trocar a senha. Pede a atual e, ao trocar, as outras sessoes deixam de valer. */
export function PasswordSection() {
  const change = useChangePassword();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (focusId) {
      document.getElementById(focusId)?.focus();
      setFocusId(null);
    }
  }, [focusId]);

  function patch(field: Field, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setNotice(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setServerError(null);
    const found = passwordFormErrors(form);
    setErrors(found);
    const first = (["current", "next", "confirm"] as const).find((field) => found[field]);
    if (first) {
      document.getElementById(IDS[first])?.focus();
      return;
    }
    try {
      await change.mutateAsync({ current_password: form.current, new_password: form.next });
      setForm({ current: "", next: "", confirm: "" });
      setNotice("Senha alterada. As outras sessões foram encerradas.");
    } catch (failure) {
      // A senha atual errada e do campo; o resto (limite de tentativas, rede) e do formulario
      if (failure instanceof ApiError && failure.code === "invalid_password") {
        setErrors({ current: "Senha atual incorreta." });
        setFocusId(IDS.current);
      } else {
        setServerError(getErrorMessage(failure));
      }
    }
  }

  const busy = change.isPending;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Senha</CardTitle>
        <CardDescription>Ao trocar, você continua conectado aqui e as outras sessões precisam entrar de novo.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          {serverError && <Alert variant="destructive">{serverError}</Alert>}
          {notice && (
            <p role="status" className="rounded-md border bg-accent/30 px-3 py-2 text-sm">
              {notice}
            </p>
          )}

          <FormField id={IDS.current} label="Senha atual" error={errors.current}>
            {(field) => <PasswordInput {...field} autoComplete="current-password" value={form.current} disabled={busy} onChange={(event) => patch("current", event.target.value)} />}
          </FormField>
          <FormField id={IDS.next} label="Nova senha" error={errors.next} hint="Pelo menos 8 caracteres.">
            {(field) => <PasswordInput {...field} autoComplete="new-password" value={form.next} disabled={busy} onChange={(event) => patch("next", event.target.value)} />}
          </FormField>
          <FormField id={IDS.confirm} label="Repita a nova senha" error={errors.confirm}>
            {(field) => <PasswordInput {...field} autoComplete="new-password" value={form.confirm} disabled={busy} onChange={(event) => patch("confirm", event.target.value)} />}
          </FormField>

          <div>
            <Button type="submit" disabled={busy}>
              {busy ? "Trocando..." : "Trocar senha"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
