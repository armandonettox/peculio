import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { useApplyTemplates, useTemplatePreview } from "@/api/envelopes";
import { getErrorMessage } from "@/api/error-messages";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMonthYear } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { kindLabel, applyCountText, reasonLabel } from "./template-presentation";
import { signOf } from "./presentation";

type Props = {
  month: string;
  onClose: () => void;
};

/** Mostra o que aplicar os templates faria neste mes e so grava quando a pessoa confirma. */
export function ApplyTemplatesDialog({ month, onClose }: Props) {
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useTemplatePreview({ month, overwrite, enabled: true });
  const apply = useApplyTemplates(month);

  const groups = (preview.data?.groups ?? []).filter((group) => group.rows.length > 0);
  const changes = groups.reduce((sum, group) => sum + group.rows.filter((row) => row.applies).length, 0);
  const busy = apply.isPending;

  async function confirm() {
    setError(null);
    try {
      await apply.mutateAsync(overwrite);
      onClose();
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  let body;
  if (preview.isPending) {
    body = (
      <p className="text-sm text-muted-foreground" role="status">
        Calculando a prévia...
      </p>
    );
  } else if (preview.isError) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(preview.error)}
        </Alert>
        <Button variant="outline" onClick={() => void preview.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  } else if (groups.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground">
        Nenhum envelope tem template ainda. Escolha um no menu da linha do envelope.
      </p>
    );
  } else {
    body = (
      <div className="flex flex-col gap-5">
        {groups.map((group) => {
          const negative = signOf(group.to_budget_after) < 0;
          return (
            <section key={group.currency_code} aria-label={`Prévia em ${group.currency_code}`} className="flex flex-col gap-2">
              <p className={cn("text-sm", negative && "font-medium text-destructive")}>
                A orçar ({group.currency_code}): {formatMoney(group.to_budget_before, group.currency_code)} depois de aplicar fica{" "}
                <strong>{formatMoney(group.to_budget_after, group.currency_code)}</strong>
              </p>
              {negative && (
                <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  Os templates somam mais do que você tem. Dá para aplicar mesmo assim: o A orçar fica negativo até você ajustar.
                </p>
              )}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Prévia em {group.currency_code}</caption>
                  <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-2 py-2 font-medium">
                        Envelope
                      </th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">
                        Hoje
                      </th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">
                        Fica
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {group.rows.map((row) => (
                      <tr key={row.budget_id}>
                        <th scope="row" className="px-2 py-2 font-medium">
                          {row.name}
                          <span className="block text-xs font-normal text-muted-foreground">{kindLabel(row.kind)}</span>
                        </th>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {formatMoney(row.current, group.currency_code)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {row.applies ? (
                            <span className="font-semibold">{formatMoney(row.proposed, group.currency_code)}</span>
                          ) : (
                            <span className="text-muted-foreground">{formatMoney(row.current, group.currency_code)}</span>
                          )}
                          <span
                            className={cn(
                              "mt-0.5 block text-xs",
                              row.applies ? "font-medium text-primary-text" : "text-muted-foreground",
                            )}
                          >
                            {row.applies ? "Vai mudar" : row.reason ? reasonLabel(row.reason) : "Sem mudança"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Aplicar templates em {formatMonthYear(month).toLowerCase()}</DialogTitle>
          <DialogDescription>
            Veja o que cada template faria. Só grava quando você confirmar.
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive">{error}</Alert>}

        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
            className="accent-[var(--primary)]"
          />
          Sobrescrever os envelopes que já têm valor
        </label>

        {body}

        <DialogFooter>
          <p className="text-sm text-muted-foreground sm:mr-auto" role="status">
            {preview.data ? applyCountText(changes) : ""}
          </p>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void confirm()} disabled={busy || preview.isPending || changes === 0}>
            {busy ? "Aplicando..." : changes === 0 ? "Nada para aplicar" : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
