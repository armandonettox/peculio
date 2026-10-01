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

type Props = { onClose: () => void };

export function EnableTwoFactorDialog({ onClose }: Props) {
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
      setCodeError("Informe o código de 6 dígitos.");
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
          <DialogTitle>{showingCodes ? "Códigos de recuperação" : "Ativar verificação em duas etapas"}</DialogTitle>
          <DialogDescription>
            {showingCodes
              ? "A verificação em duas etapas está ativada."
              : "Use um app autenticador para gerar um código toda vez que entrar."}
          </DialogDescription>
        </DialogHeader>

        {showingCodes ? (
          <RecoveryCodesView codes={recoveryCodes} onDone={onClose} />
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {formError && <Alert variant="destructive">{formError}</Alert>}

            {setup.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                Gerando o segredo...
              </p>
            )}
            {setup.isError && (
              <div className="flex flex-col items-start gap-3">
                <Alert variant="destructive" className="w-full">
                  {getErrorMessage(setup.error)}
                </Alert>
                <Button type="button" variant="outline" onClick={() => setup.mutate()}>
                  Tentar de novo
                </Button>
              </div>
            )}

            {setup.data && (
              <>
                <div className="flex flex-col gap-2">
                  <p className="text-sm">
                    <strong>1.</strong> Abra o app autenticador (Google Authenticator, Authy, 1Password ou outro) e
                    escaneie o QR code.
                  </p>
                  <div className="flex justify-center">
                    <QrCode value={setup.data.otpauth_url} label="QR code para o app autenticador" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Não consegue escanear? Digite este segredo no app:
                  </p>
                  <p className="select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm" aria-label="Segredo">
                    {setup.data.secret}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-sm">
                    <strong>2.</strong> Digite o código de 6 dígitos que o app mostra.
                  </p>
                  <FormField id="enable-code" label="Código de verificação" error={codeError}>
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
                Cancelar
              </Button>
              <Button type="submit" disabled={busy || !setup.data}>
                {busy ? "Ativando..." : "Ativar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
