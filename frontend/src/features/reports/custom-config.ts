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

export const GROUP_BY_OPTIONS: { value: ReportGroupBy; label: string; column: string }[] = [
  { value: "category", label: "Categoria", column: "Categoria" },
  { value: "tag", label: "Tag", column: "Tag" },
  { value: "budget", label: "Orçamento", column: "Orçamento" },
  { value: "account", label: "Conta", column: "Conta" },
  { value: "counterparty", label: "Contraparte", column: "Contraparte" },
  { value: "month", label: "Mês", column: "Mês" },
];

export const MEASURE_OPTIONS: { value: ReportMeasure; label: string }[] = [
  { value: "expense", label: "Despesas" },
  { value: "income", label: "Receitas" },
  { value: "net", label: "Saldo (receitas menos despesas)" },
];

export const CHART_OPTIONS: { value: ReportChart; label: string }[] = [
  { value: "table", label: "Tabela" },
  { value: "bar", label: "Barras" },
  { value: "line", label: "Linha" },
  { value: "donut", label: "Rosca" },
];

export const PERIOD_OPTIONS: { value: SavedPeriod; label: string }[] = [
  { value: "this-month", label: "Este mês" },
  { value: "last-month", label: "Mês passado" },
  { value: "last-3-months", label: "Últimos 3 meses" },
  { value: "last-12-months", label: "Últimos 12 meses" },
  { value: "this-year", label: "Este ano" },
  { value: "fixed", label: "Datas fixas" },
];

const labelOf = <T extends string>(options: { value: T; label: string }[], value: T) =>
  options.find((option) => option.value === value)?.label ?? value;

export const groupByLabel = (value: ReportGroupBy) => labelOf(GROUP_BY_OPTIONS, value);
export const measureLabel = (value: ReportMeasure) => labelOf(MEASURE_OPTIONS, value);
export const chartLabel = (value: ReportChart) => labelOf(CHART_OPTIONS, value);
export const periodLabel = (value: SavedPeriod) => labelOf(PERIOD_OPTIONS, value);

// ---------- Regras da combinacao (as mesmas do servidor) ----------

/** Por que a combinacao nao faz sentido, ou null se serve. */
export function configError(groupBy: ReportGroupBy, chart: ReportChart, measure: ReportMeasure): string | null {
  // A linha liga pontos no tempo: so o agrupamento por mes tem uma ordem
  if (chart === "line" && groupBy !== "month") return "O gráfico de linha só serve para agrupar por mês.";
  if (chart === "donut") {
    // A rosca mostra fatias de um todo: meses nao sao partes de um todo e o saldo pode ser negativo
    if (groupBy === "month") return "O gráfico de rosca não serve para agrupar por mês.";
    if (measure === "net") return "O gráfico de rosca não serve para o saldo, que pode ser negativo.";
  }
  return null;
}

export const chartAllowed = (groupBy: ReportGroupBy, chart: ReportChart, measure: ReportMeasure) =>
  configError(groupBy, chart, measure) === null;

export function allowedCharts(groupBy: ReportGroupBy, measure: ReportMeasure): ReportChart[] {
  return CHART_OPTIONS.map((option) => option.value).filter((chart) => chartAllowed(groupBy, chart, measure));
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
  if (!config.dateFrom || !config.dateTo) return "Informe as duas datas.";
  if (config.dateFrom > config.dateTo) return "A data inicial é depois da data final.";
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
    ["conta", config.accountId, known.accounts],
    ["categoria", config.categoryId, known.categories],
    ["tag", config.tagId, known.tags],
    ["orçamento", config.budgetId, known.budgets],
  ];
  return checks.filter(([, id, ids]) => id !== "" && ids !== undefined && !ids.includes(id)).map(([name]) => name);
}

/** O titulo do relatorio: "Despesas por categoria", "Saldo mes a mes". */
export function reportTitle(groupBy: ReportGroupBy, measure: ReportMeasure): string {
  const what = measure === "expense" ? "Despesas" : measure === "income" ? "Receitas" : "Saldo";
  return groupBy === "month" ? `${what} mês a mês` : `${what} por ${groupByLabel(groupBy).toLowerCase()}`;
}
