import { getErrorMessage } from "@/api/error-messages";
import { HISTORY_LIMIT, usePiggyBankEvents, type PiggyBank } from "@/api/piggy-banks";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Props = { piggy: PiggyBank; onClose: () => void };

/** Os movimentos mais recentes de um cofrinho. */
export function PiggyBankHistoryDialog({ piggy, onClose }: Props) {
  const query = usePiggyBankEvents(piggy.id);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Histórico de {piggy.name}</DialogTitle>
          <DialogDescription>Quando você guardou e retirou dinheiro, do mais recente para o mais antigo.</DialogDescription>
        </DialogHeader>

        {query.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            Carregando...
          </p>
        )}
        {query.isError && (
          <div className="flex flex-col items-start gap-3">
            <Alert variant="destructive" className="w-full">
              {getErrorMessage(query.error)}
            </Alert>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Tentar de novo
            </Button>
          </div>
        )}
        {query.data && query.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">Ainda não há movimentos neste cofrinho.</p>
        )}
        {query.data && query.data.items.length > 0 && (
          <>
            <ul aria-label="Movimentos" className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-md border">
              {query.data.items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{item.kind === "add" ? "Guardou" : "Retirou"}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(item.date)}
                      {item.note ? ` · ${item.note}` : ""}
                    </p>
                  </div>
                  <p className={cn("shrink-0 tabular-nums", item.kind === "add" ? "text-positive" : "text-foreground")}>
                    {item.kind === "add" ? "+" : "−"} {formatMoney(item.amount, piggy.currency_code)}
                  </p>
                </li>
              ))}
            </ul>
            {query.data.total > HISTORY_LIMIT && (
              <p className="text-xs text-muted-foreground">
                Mostrando os {HISTORY_LIMIT} mais recentes de {query.data.total}.
              </p>
            )}
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
