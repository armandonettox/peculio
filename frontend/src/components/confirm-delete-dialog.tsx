import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  title: string;
  // Texto explicando o que vai acontecer; o nome do item entra em negrito
  itemName: string;
  consequence?: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
};

/** Confirmacao de exclusao reutilizavel. Mostra o erro do servidor sem fechar. */
export function ConfirmDeleteDialog({ title, itemName, consequence, onConfirm, onClose }: Props) {
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Excluir <strong>{itemName}</strong> não pode ser desfeito. {consequence}
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive">{error}</Alert>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? "Excluindo..." : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
