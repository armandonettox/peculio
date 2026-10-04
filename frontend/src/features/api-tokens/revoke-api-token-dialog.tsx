import { useState } from "react";

import { useRevokeApiToken, type ApiToken } from "@/api/api-tokens";
import { getErrorMessage } from "@/api/error-messages";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = { token: ApiToken; onClose: () => void };

/** Confirma a revogacao. O token para de funcionar na hora e nao da para recuperar o valor. */
export function RevokeApiTokenDialog({ token, onClose }: Props) {
  const revoke = useRevokeApiToken();
  const [error, setError] = useState<string | null>(null);
  const busy = revoke.isPending;

  async function confirm() {
    setError(null);
    try {
      await revoke.mutateAsync(token.id);
      onClose();
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revogar token</DialogTitle>
          <DialogDescription>
            Revogar <strong>{token.name}</strong> corta, agora, o acesso de quem usa esse token. Isso não pode ser
            desfeito: para voltar a usar, será preciso criar outro.
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive">{error}</Alert>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? "Revogando..." : "Revogar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
