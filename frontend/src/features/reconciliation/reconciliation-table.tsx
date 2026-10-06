import type { ReconciliationRow } from "@/api/reconciliation";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { clearedCount, entriesText, idsToChange } from "./presentation";
import { useTranslation } from "react-i18next";

type Props = {
  rows: ReconciliationRow[];
  currencyCode: string;
  pending: boolean;
  onToggle: (splitIds: string[], cleared: boolean) => void;
};

/** Os lancamentos abertos da conta ate a data do extrato. Marcar e conferir com o que o banco mostra. */
export function ReconciliationTable({ rows, currencyCode, pending, onToggle }: Props) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("reconciliation.reconciliationTable.naoHaLancamentosAbertos")}</p>;
  }
  const checked = clearedCount(rows);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground" role="status">
          {t("reconciliation.reconciliationTable.conferidosDeEntries", { checked, entries: entriesText(rows.length) })}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || checked === rows.length}
          onClick={() => onToggle(idsToChange(rows, true), true)}
        >
          {t("reconciliation.reconciliationTable.marcarTodos")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || checked === 0}
          onClick={() => onToggle(idsToChange(rows, false), false)}
        >
          {t("reconciliation.reconciliationTable.desmarcarTodos")}
        </Button>
      </div>

      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-left text-sm sm:min-w-[32rem]">
          <caption className="sr-only">{t("reconciliation.reconciliationTable.lancamentosAConferir")}</caption>
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-8 px-2 py-2 font-medium sm:w-10 sm:px-3">
                <span className="sr-only">{t("reconciliation.reconciliationTable.conferido")}</span>
              </th>
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">
                {t("common.data")}
              </th>
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">
                {t("common.descricao")}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3">
                {t("common.valor")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.split_id} className={cn(row.cleared && "bg-accent/40")}>
                <td className="px-2 py-2 sm:px-3">
                  <input
                    type="checkbox"
                    checked={row.cleared}
                    disabled={pending}
                    onChange={() => onToggle([row.split_id], !row.cleared)}
                    aria-label={t("reconciliation.reconciliationTable.conferidoDescription", { description: row.description })}
                    className="accent-[var(--primary)]"
                  />
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums sm:px-3 sm:text-sm">{formatDate(row.date)}</td>
                <td className="px-2 py-2 sm:max-w-72 sm:px-3">
                  <p className="break-words sm:truncate" title={row.description}>
                    {row.description}
                  </p>
                </td>
                <td
                  className={cn(
                    "whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums sm:px-3 sm:text-sm",
                    !row.amount.startsWith("-") && "text-positive",
                  )}
                >
                  {formatMoney(row.amount, currencyCode)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
