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
import { CustomReportsTab } from "@/features/reports/custom-reports-tab";
import { CurrencySection } from "@/features/reports/currency-section";
import {
  countActiveFilters,
  dateRangeError,
  readState,
  toReportFilters,
  writeState,
} from "@/features/reports/period";
import { dimensions } from "@/features/reports/presentation";
import { ReportFilterBar } from "@/features/reports/report-filter-bar";
import { saveBlob } from "@/lib/download";
import { useTranslation } from "react-i18next";

export default function ReportsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => readState(searchParams), [searchParams]);
  const filters = useMemo(() => toReportFilters(state), [state]);
  const activeCount = countActiveFilters(state);
  const rangeError = dateRangeError(filters);
  // Duas abas: o resumo de sempre e o relatorio personalizado. Os pedidos do resumo so rodam na aba dele.
  const tab = searchParams.get("aba") === "personalizado" ? "custom" : "summary";
  const enabled = tab === "summary" && !rangeError;

  function chooseTab(next: "summary" | "custom") {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === "custom") params.set("aba", "personalizado");
        else params.delete("aba");
        return params;
      },
      { replace: true },
    );
  }

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
      // Datas que o proprio relatorio devolveu: o arquivo bate com o que esta na tela
      const { period: _period, ...rest } = filters;
      const file = await downloadTransactionsCsv({
        ...rest,
        dateFrom: summary.data?.date_from ?? rest.dateFrom,
        dateTo: summary.data?.date_to ?? rest.dateTo,
      });
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
          {t("common.tentarDeNovo")}
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
          {t("pages.reports.carregandoRelatorio")}
        </p>
      </div>
    );
  } else if (!summary.data || summary.data.currencies.length === 0) {
    content = (
      <EmptyState
        icon={BarChart3}
        title={t("pages.reports.nadaNestePeriodo")}
        description={
          activeCount > 0
            ? t("pages.reports.nenhumaReceitaOuDespesa")
            : t("pages.reports.quandoHouverReceitasOu")
        }
        action={
          activeCount > 0 ? (
            <Button variant="outline" onClick={clearFilters}>
              {t("common.limparFiltros")}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-10">
        <p className="text-sm text-muted-foreground">
          {t("pages.reports.soEntramReceitasE")}
        </p>
        {summary.data.currencies.map((totals) => (
          <CurrencySection
            key={totals.currency_code}
            totals={totals}
            monthly={monthly.data?.currencies.find((block) => block.currency_code === totals.currency_code)}
            grouped={dimensions().map((_, index) =>
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
        title={t("pages.reports.relatorios")}
        description={t("pages.reports.deOndeVeioE")}
        actions={
          tab === "summary" ? (
            <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting || Boolean(rangeError) || !summary.data}>
              <Download />
              {exporting ? t("pages.reports.exportando") : t("pages.reports.exportarCsv")}
            </Button>
          ) : undefined
        }
      />

      <div role="group" aria-label={t("pages.reports.tipoDeRelatorio")} className="mb-6 flex gap-1">
        <Button size="sm" variant={tab === "summary" ? "default" : "outline"} aria-pressed={tab === "summary"} onClick={() => chooseTab("summary")}>
          {t("pages.reports.resumo")}
        </Button>
        <Button size="sm" variant={tab === "custom" ? "default" : "outline"} aria-pressed={tab === "custom"} onClick={() => chooseTab("custom")}>
          {t("pages.reports.personalizado")}
        </Button>
      </div>

      {exportError && (
        <Alert variant="destructive" className="mb-4">
          {exportError}
        </Alert>
      )}

      {tab === "custom" ? (
        <CustomReportsTab />
      ) : (
        <>
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
      )}
    </>
  );
}
