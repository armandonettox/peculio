import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  webhookName: string;
  // Gira o segredo e devolve a promessa; o dialogo fecha quando ela termina
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
};

/** Confirmacao antes de girar o segredo: o antigo deixa de valer na hora. */
export function RotateSecretDialog({ webhookName, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (failure) {
      setError(getErrorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Girar segredo</DialogTitle>
          <DialogDescription>
            O segredo atual de <strong>{webhookName}</strong> deixa de valer na hora. Quem recebe os avisos precisa
            usar o segredo novo para conferir a assinatura.
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive">{error}</Alert>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void confirm()} disabled={busy}>
            {busy ? "Girando..." : "Girar segredo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
