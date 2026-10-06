import { getErrorMessage } from "@/api/error-messages";
import { HISTORY_LIMIT, usePiggyBankEvents, type PiggyBank } from "@/api/piggy-banks";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type Props = { piggy: PiggyBank; onClose: () => void };

/** Os movimentos mais recentes de um cofrinho. */
export function PiggyBankHistoryDialog({ piggy, onClose }: Props) {
  const { t } = useTranslation();
  const query = usePiggyBankEvents(piggy.id);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("piggy-banks.piggyBankHistoryDialog.historicoDe", { name: piggy.name })}</DialogTitle>
          <DialogDescription>{t("piggy-banks.piggyBankHistoryDialog.quandoVoceGuardouE")}</DialogDescription>
        </DialogHeader>

        {query.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("common.carregando")}
          </p>
        )}
        {query.isError && (
          <div className="flex flex-col items-start gap-3">
            <Alert variant="destructive" className="w-full">
              {getErrorMessage(query.error)}
            </Alert>
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t("common.tentarDeNovo")}
            </Button>
          </div>
        )}
        {query.data && query.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("piggy-banks.piggyBankHistoryDialog.aindaNaoHaMovimentos")}</p>
        )}
        {query.data && query.data.items.length > 0 && (
          <>
            <ul aria-label={t("piggy-banks.piggyBankHistoryDialog.movimentos")} className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-md border">
              {query.data.items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{item.kind === "add" ? t("piggy-banks.piggyBankHistoryDialog.guardou") : t("piggy-banks.piggyBankHistoryDialog.retirou")}</p>
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
                {t("piggy-banks.piggyBankHistoryDialog.mostrandoOsMaisRecentes", { limit: HISTORY_LIMIT, total: query.data.total })}
              </p>
            )}
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.fechar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
