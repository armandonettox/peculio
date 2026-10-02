import { Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  webhookName: string;
  secret: string;
  onDone: () => void;
};

/**
 * Mostra o segredo uma unica vez. So fecha depois de marcar que guardou: o servidor guarda o segredo
 * cifrado e nao o mostra de novo (para ter outro, e preciso girar o segredo).
 */
export function SecretDialog({ webhookName, secret, onDone }: Props) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }

  return (
    // Sem fechar por Esc, clique fora ou no X: so o botao Concluir, depois de marcar a caixa
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Segredo do webhook</DialogTitle>
          <DialogDescription>
            Guarde o segredo de <strong>{webhookName}</strong> em um lugar seguro. Ele serve para conferir a assinatura
            de cada aviso e não aparece de novo.
          </DialogDescription>
        </DialogHeader>

        <code
          aria-label="Segredo"
          className="break-all rounded-md border bg-muted p-3 font-mono text-sm"
          data-testid="webhook-secret"
        >
          {secret}
        </code>

        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
            <Copy />
            Copiar
          </Button>
          <p role="status" className="text-xs text-muted-foreground">
            {copied === "ok" && "Segredo copiado."}
            {copied === "fail" && "Não foi possível copiar. Selecione e copie à mão."}
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
            className="mt-0.5 accent-[var(--primary)]"
          />
          Guardei o segredo
        </label>

        <DialogFooter>
          <Button type="button" onClick={onDone} disabled={!saved}>
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
