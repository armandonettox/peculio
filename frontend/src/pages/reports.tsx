import { BarChart3, Download } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useAccounts } from "@/api/accounts";
import { useBudgets } from "@/api/budgets";
import { getErrorMessage } from "@/api/error-messages";
import { useCategories, useTags } from "@/api/labels";
import {
  downloadTransactionsCsv,
  useReportGrouped,
  useReportMonthly,
  useReportSummary,
} from "@/api/reports";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CurrencySection } from "@/features/reports/currency-section";
import {
  countActiveFilters,
  dateRangeError,
  readState,
  toReportFilters,
  writeState,
} from "@/features/reports/period";
import { DIMENSIONS } from "@/features/reports/presentation";
import { ReportFilterBar } from "@/features/reports/report-filter-bar";
import { todayLocal } from "@/lib/dates";
import { saveBlob } from "@/lib/download";

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayLocal();
  const state = useMemo(() => readState(searchParams), [searchParams]);
  const filters = useMemo(() => toReportFilters(state, today), [state, today]);
  const activeCount = countActiveFilters(state);
  const rangeError = dateRangeError(filters);
  const enabled = !rangeError;

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const update = useCallback(
    (patch: Parameters<typeof writeState>[1]) =>
      setSearchParams((previous) => writeState(previous, patch), { replace: true }),
    [setSearchParams],
  );

  const accounts = useAccounts({ includeArchived: true });
  const categories = useCategories({ search: "" });
  const tags = useTags({ search: "" });
  const budgets = useBudgets({ activeOnly: false });

  const summary = useReportSummary(filters, { enabled });
  const monthly = useReportMonthly(filters, { enabled });
  const byCategory = useReportGrouped("category", filters, { enabled });
  const byTag = useReportGrouped("tag", filters, { enabled });
  const byBudget = useReportGrouped("budget", filters, { enabled });
  const byAccount = useReportGrouped("account", filters, { enabled });
  const grouped = [byCategory, byTag, byBudget, byAccount];
  const queries = [summary, monthly, ...grouped];

  const failed = queries.find((query) => query.isError);
  const loading = enabled && queries.some((query) => query.isPending) && !failed;

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const file = await downloadTransactionsCsv(filters);
      saveBlob(file.blob, file.filename);
    } catch (error) {
      setExportError(getErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  // Limpa conta, categoria, tag e orcamento; o periodo escolhido continua
  const clearFilters = useCallback(
    () => update({ accountId: "", categoryId: "", tagId: "", budgetId: "" }),
    [update],
  );

  function retry() {
    for (const query of queries) {
      if (query.isError) void query.refetch();
    }
  }

  let content;
  if (rangeError) {
    content = null;
  } else if (failed) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(failed.error)}
        </Alert>
        <Button variant="outline" onClick={retry}>
          Tentar de novo
        </Button>
      </div>
    );
  } else if (loading) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-3">
        {[0, 1].map((index) => (
          <div key={index} className="h-32 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          Carregando relatório...
        </p>
      </div>
    );
  } else if (!summary.data || summary.data.currencies.length === 0) {
    content = (
      <EmptyState
        icon={BarChart3}
        title="Nada neste período"
        description={
          activeCount > 0
            ? "Nenhuma receita ou despesa atende aos filtros escolhidos."
            : "Quando houver receitas ou despesas no período, o relatório aparece aqui."
        }
        action={
          activeCount > 0 ? (
            <Button variant="outline" onClick={clearFilters}>
              Limpar filtros
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-10">
        <p className="text-sm text-muted-foreground">
          Só entram receitas e despesas. Transferências, pagamento de dívidas e saldo inicial ficam de fora. Cada moeda
          é mostrada separada, sem conversão.
        </p>
        {summary.data.currencies.map((totals) => (
          <CurrencySection
            key={totals.currency_code}
            totals={totals}
            monthly={monthly.data?.currencies.find((block) => block.currency_code === totals.currency_code)}
            grouped={DIMENSIONS.map((_, index) =>
              grouped[index].data?.currencies.find((block) => block.currency_code === totals.currency_code),
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="De onde veio e para onde foi o dinheiro"
        actions={
          <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting || Boolean(rangeError)}>
            <Download />
            {exporting ? "Exportando..." : "Exportar CSV"}
          </Button>
        }
      />

      {exportError && (
        <Alert variant="destructive" className="mb-4">
          {exportError}
        </Alert>
      )}

      <ReportFilterBar
        state={state}
        activeCount={activeCount}
        dateError={rangeError}
        accounts={accounts.data ?? []}
        categories={categories.data?.items ?? []}
        tags={tags.data?.items ?? []}
        budgets={budgets.data ?? []}
        onChange={update}
        onClear={clearFilters}
      />

      {content}
    </>
  );
}
