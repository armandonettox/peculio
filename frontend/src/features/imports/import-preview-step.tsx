import { TableScroll } from "@/components/table-scroll";
import { useState } from "react";

import type { ImportPreview, ImportRow } from "@/api/imports";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  allSelectable,
  countsParts,
  entriesText,
  newRows,
  pageOf,
  rowsToImport,
  statusLabel,
} from "./preview-model";
import { useTranslation } from "react-i18next";

type Props = {
  preview: ImportPreview;
  currencyCode: string;
  accountName: string;
  chosen: ReadonlySet<number>;
  onChosenChange: (chosen: Set<number>) => void;
  onConfirm: () => void;
  onAdjustColumns: (() => void) | null;
  onBack: () => void;
  pending: boolean;
  error: string | null;
};

function StatusBadge({ row }: { row: ImportRow }) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-xs",
        row.status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
      )}
    >
      {statusLabel(row)}
    </span>
  );
}

/** Passo 3: o que vai entrar. Novas vem marcadas; as que parecem repetidas, nao. */
export function ImportPreviewStep({
  preview,
  currencyCode,
  accountName,
  chosen,
  onChosenChange,
  onConfirm,
  onAdjustColumns,
  onBack,
  pending,
  error,
}: Props) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const { rows, counts } = preview;
  const slice = pageOf(rows, page);
  const parts = countsParts(counts);
  const toImport = rowsToImport(rows, chosen).length;

  function toggle(index: number) {
    const next = new Set(chosen);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onChosenChange(next);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-sm" role="status">
          <span className="font-semibold">{parts.news}</span>
          <span className="text-muted-foreground"> · {t("imports.importPreviewStep.restoContaAccount", { rest: parts.rest, account: accountName })}</span>
        </p>
        <p className="text-sm text-muted-foreground">{t("imports.importPreviewStep.asRegrasQueVoce")}</p>
      </div>

      {counts.duplicate > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("imports.importPreviewStep.asQueParecemRepetidas")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onChosenChange(newRows(rows))}>
          {t("imports.importPreviewStep.marcarSoAsNovas")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onChosenChange(allSelectable(rows))}>
          {t("imports.importPreviewStep.marcarTodasIncluiRepetidas")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onChosenChange(new Set())}>
          {t("imports.importPreviewStep.desmarcarTudo")}
        </Button>
      </div>

      <TableScroll label={t("imports.importPreviewStep.lancamentosDoArquivo")}>
        <table className="w-full text-left text-sm sm:min-w-[40rem]">
          <caption className="sr-only">{t("imports.importPreviewStep.lancamentosDoArquivo")}</caption>
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-8 px-2 py-2 font-medium sm:w-10 sm:px-3">
                <span className="sr-only">{t("imports.importPreviewStep.importar")}</span>
              </th>
              <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                {t("imports.importPreviewStep.linha")}
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
            {slice.rows.map((row) => {
              const failed = row.status === "error";
              return (
                <tr key={row.index} className={cn(failed && "bg-destructive/5")}>
                  <td className="px-2 py-2 sm:px-3">
                    <input
                      type="checkbox"
                      checked={chosen.has(row.index) && !failed}
                      disabled={failed}
                      onChange={() => toggle(row.index)}
                      aria-label={t("imports.importPreviewStep.importarALinha", { index: row.index })}
                      className="accent-[var(--primary)]"
                    />
                  </td>
                  <td className="hidden px-3 py-2 tabular-nums text-muted-foreground sm:table-cell">{row.index}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums sm:px-3 sm:text-sm">{row.date ? formatDate(row.date) : "—"}</td>
                  <td className="px-2 py-2 sm:max-w-72 sm:px-3">
                    <p className="break-words sm:truncate" title={row.description}>
                      {row.description || "—"}
                    </p>
                    {/* A situacao fica embaixo da descricao: numa tela estreita nao ha lugar para uma coluna so dela */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusBadge row={row} />
                      {row.reason && (
                        <p className={cn("text-xs", failed ? "text-destructive" : "text-muted-foreground")}>{row.reason}</p>
                      )}
                    </div>
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums sm:px-3 sm:text-sm",
                      row.amount && !row.amount.startsWith("-") && "text-positive",
                    )}
                  >
                    {row.amount ? formatMoney(row.amount, currencyCode) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>

      {slice.pages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground" role="status">
            {t("imports.importPreviewStep.linhasDeA", { first: slice.first, last: slice.last, total: rows.length })}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={slice.page === 0} onClick={() => setPage(slice.page - 1)}>
              {t("imports.importPreviewStep.anterior")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={slice.page >= slice.pages - 1}
              onClick={() => setPage(slice.page + 1)}
            >
              {t("imports.importPreviewStep.proxima")}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
          {t("imports.importPreviewStep.escolherOutroArquivo")}
        </Button>
        {onAdjustColumns && (
          <Button type="button" variant="outline" onClick={onAdjustColumns} disabled={pending}>
            {t("imports.importPreviewStep.ajustarColunas")}
          </Button>
        )}
        <Button type="button" onClick={onConfirm} disabled={pending || toImport === 0}>
          {pending
            ? t("imports.importPreviewStep.importando")
            : toImport === 0
              ? t("imports.importPreviewStep.nadaMarcadoParaImportar")
              : t("imports.importPreviewStep.importarEntries", { entries: entriesText(toImport) })}
        </Button>
      </div>
    </div>
  );
}
