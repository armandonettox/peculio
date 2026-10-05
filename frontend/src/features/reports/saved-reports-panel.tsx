import { Trash2 } from "lucide-react";

import { getErrorMessage } from "@/api/error-messages";
import type { SavedReport } from "@/api/saved-reports";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { chartLabel, groupByLabel, measureLabel, periodLabel } from "./custom-config";

type Props = {
  reports: SavedReport[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  openId: string | null;
  onOpen: (report: SavedReport) => void;
  onRemove: (report: SavedReport) => void;
};

/** Os relatorios salvos da pessoa: abrir e excluir. */
export function SavedReportsPanel({ reports, loading, error, onRetry, openId, onOpen, onRemove }: Props) {
  let content;
  if (loading) {
    content = (
      <p className="text-sm text-muted-foreground" role="status">
        Carregando relatórios salvos...
      </p>
    );
  } else if (error) {
    content = (
      <div className="flex flex-col items-start gap-2">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(error)}
        </Alert>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Tentar de novo
        </Button>
      </div>
    );
  } else if (!reports || reports.length === 0) {
    content = <p className="text-sm text-muted-foreground">Você ainda não salvou nenhum relatório. Monte um abaixo e use “Salvar relatório”.</p>;
  } else {
    content = (
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {reports.map((report) => (
          <li key={report.id} className={cn("flex items-center gap-2 px-3 py-2", report.id === openId && "bg-accent/50")}>
            <button
              type="button"
              onClick={() => onOpen(report)}
              aria-label={`Abrir ${report.name}`}
              aria-current={report.id === openId ? "true" : undefined}
              className="flex min-w-0 flex-1 flex-col items-start rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="w-full truncate text-sm font-medium">{report.name}</span>
              <span className="w-full truncate text-xs text-muted-foreground">
                {measureLabel(report.measure).split(" (")[0]} por {groupByLabel(report.group_by).toLowerCase()} · {chartLabel(report.chart)} ·{" "}
                {periodLabel(report.period)}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(report)}
              aria-label={`Excluir ${report.name}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-destructive transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-label="Relatórios salvos" className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Relatórios salvos</h2>
      {content}
    </section>
  );
}
