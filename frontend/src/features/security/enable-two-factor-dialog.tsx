import { useEffect, useRef, useState, type FormEvent } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { useEnableTwoFactor, useSetupTwoFactor } from "@/api/two-factor";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { QrCode } from "./qr-code";
import { RecoveryCodesView } from "./recovery-codes-view";
import { useTranslation } from "react-i18next";

type Props = { onClose: () => void };

export function EnableTwoFactorDialog({ onClose }: Props) {
  const { t } = useTranslation();
  const setup = useSetupTwoFactor();
  const enable = useEnableTwoFactor();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Gera o segredo uma vez ao abrir. Pedir de novo trocaria o segredo e o QR na tela
  // deixaria de bater com o que o servidor guardou.
  const started = useRef(false);
  const { mutate: startSetup } = setup;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startSetup();
  }, [startSetup]);

  const showingCodes = recoveryCodes !== null;
  const busy = enable.isPending;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    if (code.trim() === "") {
      setCodeError(t("security.enableTwoFactorDialog.informeOCodigo"));
      document.getElementById("enable-code")?.focus();
      return;
    }
    try {
      const result = await enable.mutateAsync(code.trim());
      setRecoveryCodes(result.recovery_codes);
    } catch (error) {
      const message = getErrorMessage(error);
      // Codigo errado fica no campo; qualquer outra falha vai no aviso do topo
      if (typeof error === "object" && error !== null && "code" in error && error.code === "two_factor_invalid_code") {
        setCodeError(message);
        document.getElementById("enable-code")?.focus();
      } else {
        setFormError(message);
      }
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && !showingCodes && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{showingCodes ? t("security.enableTwoFactorDialog.codigosDeRecuperacao") : t("security.enableTwoFactorDialog.ativarVerificacaoEmDuas")}</DialogTitle>
          <DialogDescription>
            {showingCodes
              ? t("security.enableTwoFactorDialog.aVerificacaoEmDuas")
              : t("security.enableTwoFactorDialog.useUmAppAutenticador")}
          </DialogDescription>
        </DialogHeader>

        {showingCodes ? (
          <RecoveryCodesView codes={recoveryCodes} onDone={onClose} />
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {formError && <Alert variant="destructive">{formError}</Alert>}

            {setup.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                {t("security.enableTwoFactorDialog.gerandoOSegredo")}
              </p>
            )}
            {setup.isError && (
              <div className="flex flex-col items-start gap-3">
                <Alert variant="destructive" className="w-full">
                  {getErrorMessage(setup.error)}
                </Alert>
                <Button type="button" variant="outline" onClick={() => setup.mutate()}>
                  {t("common.tentarDeNovo")}
                </Button>
              </div>
            )}

            {setup.data && (
              <>
                <div className="flex flex-col gap-2">
                  <p className="text-sm">
                    <strong>1.</strong> {t("security.enableTwoFactorDialog.abraOAppAutenticador")}
                  </p>
                  <div className="flex justify-center">
                    <QrCode value={setup.data.otpauth_url} label={t("security.enableTwoFactorDialog.qrCodeParaO")} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("security.enableTwoFactorDialog.naoConsegueEscanearDigite")}
                  </p>
                  <p className="select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm" aria-label={t("security.enableTwoFactorDialog.segredo")}>
                    {setup.data.secret}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-sm">
                    <strong>2.</strong> {t("security.enableTwoFactorDialog.digiteOCodigo")}
                  </p>
                  <FormField id="enable-code" label={t("security.enableTwoFactorDialog.codigoDeVerificacao")} error={codeError}>
                    {(props) => (
                      <Input
                        {...props}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        value={code}
                        onChange={(event) => {
                          setCode(event.target.value);
                          setCodeError(undefined);
                        }}
                      />
                    )}
                  </FormField>
                </div>
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                {t("common.cancelar")}
              </Button>
              <Button type="submit" disabled={busy || !setup.data}>
                {busy ? t("security.enableTwoFactorDialog.ativando") : t("security.enableTwoFactorDialog.ativar")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
