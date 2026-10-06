import { DonutChart, LineChart } from "@/components/charts";
import type { MonthlyBlock, ReportGroupBlock } from "@/api/reports";
import { formatMoney } from "@/lib/money";
import { i18n } from "@/i18n";
import { groupByLabel, groupByOptions, measureLabel, reportTitle, type CustomConfig } from "./custom-config";
import { monthItems, monthPoints, monthRows, othersLabel, rankRows, topWithOthers, TOP_LIMIT } from "./custom-data";
import { CustomTable } from "./custom-table";
import { RankedBars } from "./ranked-bars";
import { useTranslation } from "react-i18next";

// O texto da linha sem categoria, orcamento ou tag (o servidor manda o id nulo)
function fallbackOf(groupBy: string): string {
  switch (groupBy) {
    case "category":
      return i18n.t("reports.customReportView.fallback.category");
    case "tag":
      return i18n.t("reports.customReportView.fallback.tag");
    case "budget":
      return i18n.t("reports.customReportView.fallback.budget");
    case "account":
      return i18n.t("reports.customReportView.fallback.account");
    case "counterparty":
      return i18n.t("reports.customReportView.fallback.counterparty");
    default:
      return "";
  }
}

type Props = {
  config: CustomConfig;
  // Um bloco por moeda. Agrupando por mes vem o mensal; nos outros casos vem o agrupado.
  grouped?: ReportGroupBlock[];
  monthly?: MonthlyBlock[];
};

type CurrencyProps = { config: CustomConfig; code: string; group?: ReportGroupBlock; month?: MonthlyBlock };

function CurrencyReport({ config, code, group, month }: CurrencyProps) {
  const { t } = useTranslation();
  const title = reportTitle(config.groupBy, config.measure);
  const titleEm = t("reports.customReportView.tituloEm", { title, code });
  const column = groupByOptions().find((option) => option.value === config.groupBy)?.column ?? "";
  const rows = month ? monthRows(month) : (group?.rows ?? []);
  const fallback = fallbackOf(config.groupBy);
  const format = (value: string) => formatMoney(value, code);

  let chart = null;
  if (config.chart !== "table") {
    if (month && config.chart === "line") {
      chart = (
        <LineChart
          title={titleEm}
          series={[{ key: config.measure, label: measureLabel(config.measure), points: monthPoints(month, config.measure) }]}
          formatValue={format}
          formatX={(x) => monthItems(month, config.measure).find((item) => item.key === x)?.label ?? x}
        />
      );
    } else if (month && config.chart === "bar") {
      chart = <RankedBars title={titleEm} items={monthItems(month, config.measure)} currencyCode={code} measure={config.measure} />;
    } else if (group) {
      const ranked = rankRows(group.rows, config.measure, fallback);
      if (ranked.length === 0) {
        chart = (
          <p className="text-sm text-muted-foreground">
            {t("reports.customReportView.nenhumGrupoTem", { measure: measureLabel(config.measure).toLowerCase() })}
          </p>
        );
      } else if (config.chart === "donut") {
        chart = (
          <DonutChart
            title={titleEm}
            slices={ranked.map((item) => ({ key: item.key, label: item.label, value: item.value }))}
            formatValue={format}
            // Os maiores e uma fatia "Outros" com o resto (a fatia de Outros conta dentro do limite)
            maxSlices={TOP_LIMIT + 1}
            otherLabel={othersLabel()}
          />
        );
      } else {
        chart = <RankedBars title={titleEm} items={topWithOthers(ranked, code)} currencyCode={code} measure={config.measure} />;
      }
    }
  }

  const more = config.chart !== "table" && !month && group && rankRows(group.rows, config.measure, fallback).length > TOP_LIMIT + 1;

  return (
    <section aria-label={titleEm} className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-primary-text">{code}</h3>
      {chart}
      {more && (
        <p className="text-xs text-muted-foreground">
          {t("reports.customReportView.oGraficoMostra", { limit: TOP_LIMIT, label: othersLabel() })}
        </p>
      )}
      <CustomTable
        title={title}
        column={column}
        fallback={fallback}
        rows={rows}
        currencyCode={code}
        note={config.groupBy === "tag" ? t("reports.customReportView.tagNote") : undefined}
      />
    </section>
  );
}

/** O relatorio montado, moeda por moeda (moedas diferentes nunca se misturam). */
export function CustomReportView({ config, grouped, monthly }: Props) {
  const { t } = useTranslation();
  const codes = config.groupBy === "month" ? (monthly ?? []).map((block) => block.currency_code) : (grouped ?? []).map((block) => block.currency_code);
  if (codes.length === 0) return null;
  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-xl font-semibold">
        {reportTitle(config.groupBy, config.measure)}
        <span className="sr-only"> {t("reports.customReportView.agrupadoPor", { group: groupByLabel(config.groupBy) })}</span>
      </h2>
      {codes.map((code) => (
        <CurrencyReport
          key={code}
          config={config}
          code={code}
          group={grouped?.find((block) => block.currency_code === code)}
          month={monthly?.find((block) => block.currency_code === code)}
        />
      ))}
    </div>
  );
}
