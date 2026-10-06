import { useState, type FormEvent } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useDisableTwoFactor, useRegenerateRecoveryCodes } from "@/api/two-factor";
import { FormField } from "@/components/form-field";
import { PasswordInput } from "@/components/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RecoveryCodesView } from "./recovery-codes-view";
import { useTranslation } from "react-i18next";

export type ConfirmMode = "disable" | "regenerate";

type Props = { mode: ConfirmMode; onClose: () => void };

/** Desligar o 2FA ou trocar os codigos pede senha e um codigo: sessao aberta sozinha nao basta. */
export function ConfirmTwoFactorDialog({ mode, onClose }: Props) {
  const { t } = useTranslation();
  const disable = useDisableTwoFactor();
  const regenerate = useRegenerateRecoveryCodes();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<{ password?: string; code?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const copy =
    mode === "disable"
      ? {
          title: t("security.confirmTwoFactorDialog.desativarVerificacao"),
          description: t("security.confirmTwoFactorDialog.suaContaVolta"),
          submit: t("security.confirmTwoFactorDialog.desativar"),
          busy: t("security.confirmTwoFactorDialog.desativando"),
        }
      : {
          title: t("security.confirmTwoFactorDialog.gerarNovosCodigosDe"),
          description: t("security.confirmTwoFactorDialog.osCodigosAtuaisDeixam"),
          submit: t("security.confirmTwoFactorDialog.gerarNovosCodigos"),
          busy: t("security.confirmTwoFactorDialog.gerando"),
        };
  const busy = disable.isPending || regenerate.isPending;
  const showingCodes = newCodes !== null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);

    const found = {
      password: password === "" ? t("security.confirmTwoFactorDialog.informeASenha") : undefined,
      code: code.trim() === "" ? t("security.confirmTwoFactorDialog.informeUmCodigo") : undefined,
    };
    setErrors(found);
    const first = (["password", "code"] as const).find((field) => found[field]);
    if (first) {
      document.getElementById(`confirm-${first}`)?.focus();
      return;
    }

    const body = { password, code: code.trim() };
    try {
      if (mode === "disable") {
        await disable.mutateAsync(body);
        onClose();
      } else {
        const result = await regenerate.mutateAsync(body);
        setNewCodes(result.recovery_codes);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      if (error instanceof ApiError && error.code === "invalid_password") {
        setErrors({ password: message });
        document.getElementById("confirm-password")?.focus();
      } else if (error instanceof ApiError && error.code === "two_factor_invalid_code") {
        setErrors({ code: message });
        document.getElementById("confirm-code")?.focus();
      } else {
        setFormError(message);
      }
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && !showingCodes && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{showingCodes ? t("security.confirmTwoFactorDialog.novosCodigosDeRecuperacao") : copy.title}</DialogTitle>
          <DialogDescription>{showingCodes ? t("security.confirmTwoFactorDialog.osCodigosAntigosNao") : copy.description}</DialogDescription>
        </DialogHeader>

        {showingCodes ? (
          <RecoveryCodesView codes={newCodes} onDone={onClose} />
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {formError && <Alert variant="destructive">{formError}</Alert>}

            <FormField id="confirm-password" label={t("common.senha")} error={errors.password}>
              {(props) => (
                <PasswordInput
                  {...props}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setErrors((current) => ({ ...current, password: undefined }));
                  }}
                />
              )}
            </FormField>

            <FormField
              id="confirm-code"
              label={t("security.confirmTwoFactorDialog.codigoDeVerificacao")}
              error={errors.code}
              hint={t("security.confirmTwoFactorDialog.codigoDe6Digitos")}
            >
              {(props) => (
                <Input
                  {...props}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setErrors((current) => ({ ...current, code: undefined }));
                  }}
                />
              )}
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                {t("common.cancelar")}
              </Button>
              <Button type="submit" variant={mode === "disable" ? "destructive" : "default"} disabled={busy}>
                {busy ? copy.busy : copy.submit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
