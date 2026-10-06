import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";

import { useAccounts } from "@/api/accounts";
import { useBudgets } from "@/api/budgets";
import { getErrorMessage } from "@/api/error-messages";
import { useCategories, useTags } from "@/api/labels";
import { useReportGrouped, useReportMonthly, type GroupedDimension } from "@/api/reports";
import { useDeleteSavedReport, useSavedReports, type SavedReport } from "@/api/saved-reports";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { CustomReportBuilder } from "./custom-report-builder";
import { CustomReportView } from "./custom-report-view";
import { DEFAULT_CONFIG, fromSaved, missingFilters, periodError, sameConfig, toApiFilters, type CustomConfig } from "./custom-config";
import { SaveReportDialog } from "./save-report-dialog";
import { SavedReportsPanel } from "./saved-reports-panel";
import { useTranslation } from "react-i18next";

/** A aba "Personalizado": monta um relatorio (agrupar, medir, grafico, periodo, filtros), salva e abre os salvos. */
export function CustomReportsTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<CustomConfig>(DEFAULT_CONFIG);
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<SavedReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const saved = useSavedReports();
  const remove = useDeleteSavedReport();
  const accounts = useAccounts({ includeArchived: true });
  const categories = useCategories({ search: "" });
  const tags = useTags({ search: "" });
  const budgets = useBudgets({ activeOnly: false });

  const rangeError = periodError(config);
  const filters = useMemo(() => toApiFilters(config), [config]);
  const byMonth = config.groupBy === "month";
  // Os dois ganchos existem sempre (regra dos ganchos); so um deles faz o pedido
  const grouped = useReportGrouped(byMonth ? "category" : (config.groupBy as GroupedDimension), filters, { enabled: !rangeError && !byMonth });
  const monthly = useReportMonthly(filters, { enabled: !rangeError && byMonth });
  const query = byMonth ? monthly : grouped;

  const openReport = saved.data?.find((report) => report.id === openId) ?? null;
  const modified = openReport !== null && !sameConfig(config, fromSaved(openReport));
  const missing = missingFilters(config, {
    accounts: accounts.data?.map((item) => item.id),
    categories: categories.data?.items.map((item) => item.id),
    tags: tags.data?.items.map((item) => item.id),
    budgets: budgets.data?.map((item) => item.id),
  });

  function open(report: SavedReport) {
    setConfig(fromSaved(report));
    setOpenId(report.id);
    setNotice(null);
  }

  function startNew() {
    setConfig(DEFAULT_CONFIG);
    setOpenId(null);
    setNotice(null);
  }

  async function confirmRemove(report: SavedReport) {
    await remove.mutateAsync(report.id);
    if (report.id === openId) setOpenId(null);
    setNotice(t("reports.customReportsTab.relatorioExcluido"));
  }

  let result;
  if (rangeError) {
    result = null;
  } else if (query.isError) {
    result = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(query.error)}
        </Alert>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("common.tentarDeNovo")}
        </Button>
      </div>
    );
  } else if (query.isPending) {
    result = (
      <div aria-busy="true" className="flex flex-col gap-3">
        <div className="h-32 animate-pulse rounded-lg border bg-muted" />
        <p className="sr-only" role="status">
          {t("reports.customReportsTab.carregandoRelatorio")}
        </p>
      </div>
    );
  } else if (query.data.currencies.length === 0) {
    result = (
      <EmptyState
        icon={BarChart3}
        title={t("reports.customReportsTab.nadaNestePeriodo")}
        description={t("reports.customReportsTab.nenhumaReceitaOuDespesa")}
      />
    );
  } else {
    result = (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t("reports.customReportsTab.periodoDeA", { from: formatDate(query.data.date_from), to: formatDate(query.data.date_to) })}
        </p>
        <CustomReportView
          config={config}
          grouped={byMonth ? undefined : (query.data.currencies as Parameters<typeof CustomReportView>[0]["grouped"])}
          monthly={byMonth ? (query.data.currencies as Parameters<typeof CustomReportView>[0]["monthly"]) : undefined}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SavedReportsPanel
        reports={saved.data}
        loading={saved.isPending}
        error={saved.isError ? saved.error : null}
        onRetry={() => void saved.refetch()}
        openId={openId}
        onOpen={open}
        onRemove={setRemoving}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setSaving(true)} disabled={Boolean(rangeError)}>
          {t("reports.customReportsTab.salvarRelatorio")}
        </Button>
        <Button variant="outline" onClick={startNew}>
          {t("reports.customReportsTab.novoRelatorio")}
        </Button>
        {openReport && (
          <p className="text-sm text-muted-foreground">
            {t("reports.customReportsTab.aberto")} <strong>{openReport.name}</strong>
            {modified ? ` ${t("reports.customReportsTab.comMudancasAindaNao")}` : ""}
          </p>
        )}
      </div>

      {notice && (
        <p role="status" className="rounded-md border bg-accent/30 px-3 py-2 text-sm">
          {notice}
        </p>
      )}

      <CustomReportBuilder
        config={config}
        onChange={(next) => {
          setConfig(next);
          setNotice(null);
        }}
        periodError={rangeError}
        missing={missing}
        accounts={accounts.data ?? []}
        categories={categories.data?.items ?? []}
        tags={tags.data?.items ?? []}
        budgets={budgets.data ?? []}
      />

      {result}

      {saving && (
        <SaveReportDialog
          config={config}
          current={openReport}
          onSaved={(report) => {
            setOpenId(report.id);
            setNotice(t("reports.customReportsTab.relatorioSalvo"));
          }}
          onClose={() => setSaving(false)}
        />
      )}
      {removing && (
        <ConfirmDeleteDialog
          title={t("reports.customReportsTab.excluirRelatorioSalvo")}
          itemName={removing.name}
          consequence={t("reports.customReportsTab.soORelatorioSalvo")}
          onConfirm={() => confirmRemove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
