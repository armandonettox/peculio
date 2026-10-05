import { DonutChart, LineChart } from "@/components/charts";
import type { MonthlyBlock, ReportGroupBlock } from "@/api/reports";
import { formatMoney } from "@/lib/money";
import { groupByLabel, measureLabel, reportTitle, GROUP_BY_OPTIONS, type CustomConfig } from "./custom-config";
import { monthItems, monthPoints, monthRows, rankRows, topWithOthers, TOP_LIMIT, OTHERS_LABEL } from "./custom-data";
import { CustomTable } from "./custom-table";
import { RankedBars } from "./ranked-bars";

// O texto da linha sem categoria, orcamento ou tag (o servidor manda o id nulo)
const FALLBACKS: Record<string, string> = {
  category: "Sem categoria",
  tag: "Sem tag",
  budget: "Sem orçamento",
  account: "Sem conta",
  counterparty: "Sem contraparte",
};

const TAG_NOTE = "Um lançamento com várias tags aparece em cada uma delas, então a soma das linhas pode passar do total.";

type Props = {
  config: CustomConfig;
  // Um bloco por moeda. Agrupando por mes vem o mensal; nos outros casos vem o agrupado.
  grouped?: ReportGroupBlock[];
  monthly?: MonthlyBlock[];
};

type CurrencyProps = { config: CustomConfig; code: string; group?: ReportGroupBlock; month?: MonthlyBlock };

function CurrencyReport({ config, code, group, month }: CurrencyProps) {
  const title = reportTitle(config.groupBy, config.measure);
  const column = GROUP_BY_OPTIONS.find((option) => option.value === config.groupBy)?.column ?? "";
  const rows = month ? monthRows(month) : (group?.rows ?? []);
  const fallback = FALLBACKS[config.groupBy] ?? "";
  const format = (value: string) => formatMoney(value, code);

  let chart = null;
  if (config.chart !== "table") {
    if (month && config.chart === "line") {
      chart = (
        <LineChart
          title={`${title} em ${code}`}
          series={[{ key: config.measure, label: measureLabel(config.measure), points: monthPoints(month, config.measure) }]}
          formatValue={format}
          formatX={(x) => monthItems(month, config.measure).find((item) => item.key === x)?.label ?? x}
        />
      );
    } else if (month && config.chart === "bar") {
      chart = <RankedBars title={`${title} em ${code}`} items={monthItems(month, config.measure)} currencyCode={code} measure={config.measure} />;
    } else if (group) {
      const ranked = rankRows(group.rows, config.measure, fallback);
      if (ranked.length === 0) {
        chart = <p className="text-sm text-muted-foreground">Nenhum grupo tem {measureLabel(config.measure).toLowerCase()} neste período.</p>;
      } else if (config.chart === "donut") {
        chart = (
          <DonutChart
            title={`${title} em ${code}`}
            slices={ranked.map((item) => ({ key: item.key, label: item.label, value: item.value }))}
            formatValue={format}
            // Os maiores e uma fatia "Outros" com o resto (a fatia de Outros conta dentro do limite)
            maxSlices={TOP_LIMIT + 1}
            otherLabel={OTHERS_LABEL}
          />
        );
      } else {
        chart = (
          <RankedBars title={`${title} em ${code}`} items={topWithOthers(ranked, code)} currencyCode={code} measure={config.measure} />
        );
      }
    }
  }

  const more = config.chart !== "table" && !month && group && rankRows(group.rows, config.measure, fallback).length > TOP_LIMIT + 1;

  return (
    <section aria-label={`${title} em ${code}`} className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-primary-text">{code}</h3>
      {chart}
      {more && (
        <p className="text-xs text-muted-foreground">
          O gráfico mostra os {TOP_LIMIT} maiores e junta o resto em “{OTHERS_LABEL}”. A tabela abaixo tem todos.
        </p>
      )}
      <CustomTable
        title={title}
        column={column}
        fallback={fallback}
        rows={rows}
        currencyCode={code}
        note={config.groupBy === "tag" ? TAG_NOTE : undefined}
      />
    </section>
  );
}

/** O relatorio montado, moeda por moeda (moedas diferentes nunca se misturam). */
export function CustomReportView({ config, grouped, monthly }: Props) {
  const codes = config.groupBy === "month" ? (monthly ?? []).map((block) => block.currency_code) : (grouped ?? []).map((block) => block.currency_code);
  if (codes.length === 0) return null;
  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-xl font-semibold">
        {reportTitle(config.groupBy, config.measure)}
        <span className="sr-only"> (agrupado por {groupByLabel(config.groupBy)})</span>
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
