import type { WebhookDelivery } from "@/api/webhooks";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { httpText } from "./presentation";

type Props = {
  webhookName: string;
  // Sem resultado nem erro: o teste ainda esta sendo enviado
  result: WebhookDelivery | null;
  error: string | null;
  onClose: () => void;
};

export function TestResultDialog({ webhookName, result, error, onClose }: Props) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Teste do webhook</DialogTitle>
          <DialogDescription>
            Aviso de teste enviado agora para <strong>{webhookName}</strong>. Ele não entra nas retentativas.
          </DialogDescription>
        </DialogHeader>

        {!result && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            Enviando o teste...
          </p>
        )}

        {error && <Alert variant="destructive">{error}</Alert>}

        {result && (
          <div className="flex flex-col gap-2">
            {result.status === "delivered" ? (
              <Alert>Entregue com sucesso ({httpText(result)}).</Alert>
            ) : (
              <Alert variant="destructive">
                Não foi entregue ({httpText(result)}){result.last_error ? `: ${result.last_error}` : ""}
              </Alert>
            )}
            {result.response_excerpt && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Resposta do endereço</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted p-2 text-xs">
                  {result.response_excerpt}
                </pre>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
