import { i18n } from "@/i18n";
import type { ReportFilters } from "@/api/reports";
import type {
  ReportChart,
  ReportGroupBy,
  ReportMeasure,
  SavedPeriod,
  SavedReport,
  SavedReportBody,
} from "@/api/saved-reports";

// O relatorio personalizado, sem tela: o que a pessoa montou, as regras de combinacao, a conversao para a API e a
// comparacao com o que esta salvo. Fica aqui, com testes, e a tela so usa.

export type CustomConfig = {
  groupBy: ReportGroupBy;
  chart: ReportChart;
  measure: ReportMeasure;
  period: SavedPeriod;
  // So no periodo "fixed"; "" = nao informada
  dateFrom: string;
  dateTo: string;
  // "" = todos
  accountId: string;
  categoryId: string;
  tagId: string;
  budgetId: string;
};

export const DEFAULT_CONFIG: CustomConfig = {
  groupBy: "category",
  chart: "donut",
  measure: "expense",
  period: "this-month",
  dateFrom: "",
  dateTo: "",
  accountId: "",
  categoryId: "",
  tagId: "",
  budgetId: "",
};

const GROUP_BY_VALUES: ReportGroupBy[] = ["category", "tag", "budget", "account", "counterparty", "month"];
const MEASURE_VALUES: ReportMeasure[] = ["expense", "income", "net"];
const CHART_VALUES: ReportChart[] = ["table", "bar", "line", "donut"];
const PERIOD_VALUES: SavedPeriod[] = ["this-month", "last-month", "last-3-months", "last-12-months", "this-year", "fixed"];

export function groupByOptions(): { value: ReportGroupBy; label: string; column: string }[] {
  return GROUP_BY_VALUES.map((value) => ({
    value,
    label: i18n.t(`reports.customConfig.groupBy.${value}`),
    column: i18n.t(`reports.customConfig.groupBy.${value}`),
  }));
}

export function measureOptions(): { value: ReportMeasure; label: string }[] {
  return MEASURE_VALUES.map((value) => ({ value, label: i18n.t(`reports.customConfig.measure.${value}`) }));
}

export function chartOptions(): { value: ReportChart; label: string }[] {
  return CHART_VALUES.map((value) => ({ value, label: i18n.t(`reports.customConfig.chart.${value}`) }));
}

export function periodOptions(): { value: SavedPeriod; label: string }[] {
  return PERIOD_VALUES.map((value) => ({ value, label: i18n.t(`reports.customConfig.period.${value}`) }));
}

export const groupByLabel = (value: ReportGroupBy) => i18n.t(`reports.customConfig.groupBy.${value}`);
export const measureLabel = (value: ReportMeasure) => i18n.t(`reports.customConfig.measure.${value}`);
export const chartLabel = (value: ReportChart) => i18n.t(`reports.customConfig.chart.${value}`);
export const periodLabel = (value: SavedPeriod) => i18n.t(`reports.customConfig.period.${value}`);

// ---------- Regras da combinacao (as mesmas do servidor) ----------

/** Por que a combinacao nao faz sentido, ou null se serve. */
export function configError(groupBy: ReportGroupBy, chart: ReportChart, measure: ReportMeasure): string | null {
  // A linha liga pontos no tempo: so o agrupamento por mes tem uma ordem
  if (chart === "line" && groupBy !== "month") return i18n.t("reports.customConfig.lineOnlyForMonth");
  if (chart === "donut") {
    // A rosca mostra fatias de um todo: meses nao sao partes de um todo e o saldo pode ser negativo
    if (groupBy === "month") return i18n.t("reports.customConfig.donutNotForMonth");
    if (measure === "net") return i18n.t("reports.customConfig.donutNotForNet");
  }
  return null;
}

export const chartAllowed = (groupBy: ReportGroupBy, chart: ReportChart, measure: ReportMeasure) =>
  configError(groupBy, chart, measure) === null;

export function allowedCharts(groupBy: ReportGroupBy, measure: ReportMeasure): ReportChart[] {
  return CHART_VALUES.filter((chart) => chartAllowed(groupBy, chart, measure));
}

/**
 * Depois de mudar o agrupamento ou a medida, o grafico pode nao servir mais: troca por um que sirva (linha para o mes,
 * barras para o resto). A tabela serve sempre.
 */
export function normalize(config: CustomConfig): CustomConfig {
  if (chartAllowed(config.groupBy, config.chart, config.measure)) return config;
  return { ...config, chart: config.groupBy === "month" ? "line" : "bar" };
}

// ---------- Periodo ----------

/** Datas fixas incompletas ou ao contrario; undefined se esta tudo certo. */
export function periodError(config: CustomConfig): string | undefined {
  if (config.period !== "fixed") return undefined;
  if (!config.dateFrom || !config.dateTo) return i18n.t("reports.customConfig.informeAsDatas");
  if (config.dateFrom > config.dateTo) return i18n.t("reports.customConfig.dataInicialDepoisDaFinal");
  return undefined;
}

/** O que vai para as rotas de relatorio: periodo pronto vai como `period` (o servidor conta pelo relogio do app). */
export function toApiFilters(config: CustomConfig): ReportFilters {
  const filters: ReportFilters = {};
  if (config.period === "fixed") {
    if (config.dateFrom) filters.dateFrom = config.dateFrom;
    if (config.dateTo) filters.dateTo = config.dateTo;
  } else {
    filters.period = config.period;
  }
  if (config.accountId) filters.accountId = config.accountId;
  if (config.categoryId) filters.categoryId = config.categoryId;
  if (config.tagId) filters.tagId = config.tagId;
  if (config.budgetId) filters.budgetId = config.budgetId;
  return filters;
}

// ---------- Salvar e abrir ----------

export function toBody(config: CustomConfig, name: string): SavedReportBody {
  return {
    name: name.trim(),
    group_by: config.groupBy,
    chart: config.chart,
    measure: config.measure,
    period: config.period,
    ...(config.period === "fixed" ? { date_from: config.dateFrom, date_to: config.dateTo } : {}),
    account_id: config.accountId || null,
    category_id: config.categoryId || null,
    tag_id: config.tagId || null,
    budget_id: config.budgetId || null,
  };
}

export function fromSaved(report: SavedReport): CustomConfig {
  return {
    groupBy: report.group_by,
    chart: report.chart,
    measure: report.measure,
    period: report.period,
    dateFrom: report.date_from ?? "",
    dateTo: report.date_to ?? "",
    accountId: report.account_id ?? "",
    categoryId: report.category_id ?? "",
    tagId: report.tag_id ?? "",
    budgetId: report.budget_id ?? "",
  };
}

/** Igual ao que esta salvo? As datas so contam no periodo fixo. */
export function sameConfig(a: CustomConfig, b: CustomConfig): boolean {
  const dates = a.period === "fixed" && b.period === "fixed" ? a.dateFrom === b.dateFrom && a.dateTo === b.dateTo : true;
  return (
    dates &&
    a.groupBy === b.groupBy &&
    a.chart === b.chart &&
    a.measure === b.measure &&
    a.period === b.period &&
    a.accountId === b.accountId &&
    a.categoryId === b.categoryId &&
    a.tagId === b.tagId &&
    a.budgetId === b.budgetId
  );
}

// ---------- Filtros que nao existem mais ----------

export type KnownIds = { accounts?: string[]; categories?: string[]; tags?: string[]; budgets?: string[] };

/**
 * Os filtros do relatorio cujo item foi excluido, pelo nome do filtro ("categoria"). O relatorio guarda so o id: sem
 * este aviso a pessoa veria um filtro "vazio" sem saber que o relatorio esta filtrando por algo que sumiu. Uma lista
 * ainda nao carregada (undefined) nao conta.
 */
export function missingFilters(config: CustomConfig, known: KnownIds): string[] {
  const checks: [string, string, string[] | undefined][] = [
    [i18n.t("reports.customConfig.filterName.account"), config.accountId, known.accounts],
    [i18n.t("reports.customConfig.filterName.category"), config.categoryId, known.categories],
    [i18n.t("reports.customConfig.filterName.tag"), config.tagId, known.tags],
    [i18n.t("reports.customConfig.filterName.budget"), config.budgetId, known.budgets],
  ];
  return checks.filter(([, id, ids]) => id !== "" && ids !== undefined && !ids.includes(id)).map(([name]) => name);
}

/** O titulo do relatorio: "Despesas por categoria", "Saldo mes a mes". */
export function reportTitle(groupBy: ReportGroupBy, measure: ReportMeasure): string {
  const what = i18n.t(`reports.customConfig.reportTitleWhat.${measure}`);
  return groupBy === "month"
    ? i18n.t("reports.customConfig.reportTitleByMonth", { what })
    : i18n.t("reports.customConfig.reportTitleByGroup", { what, group: groupByLabel(groupBy).toLowerCase() });
}
