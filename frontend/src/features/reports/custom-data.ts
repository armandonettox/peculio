import type { ChartPoint } from "@/components/charts";
import type { MonthlyBlock, ReportRow } from "@/api/reports";
import type { ReportMeasure } from "@/api/saved-reports";
import { i18n } from "@/i18n";
import { isNegativeMoney, negateMoney, placesOf, sumMoney } from "@/lib/money";
import { barPercent, longMonthLabel, rowName, shortMonthLabel } from "./presentation";

// Os dados dos graficos do relatorio personalizado, sem tela: a medida de cada linha, o ranking com "Outros" e a serie
// por mes. Dinheiro e sempre texto decimal; so a ordem e o tamanho da barra usam numero.

export type Amounts = { income: string; expense: string; net: string };

export function measureValue(source: Amounts, measure: ReportMeasure): string {
  return measure === "expense" ? source.expense : measure === "income" ? source.income : source.net;
}

export type RankedItem = { key: string; label: string; value: string; isOther: boolean };

export function othersLabel(): string {
  return i18n.t("reports.customData.outros");
}
// Quantos grupos os graficos mostram antes de juntar o resto em "Outros"
export const TOP_LIMIT = 10;

const isZero = (value: string) => /^-?0+(\.0+)?$/.test(value);
const abs = (value: string) => (isNegativeMoney(value) ? negateMoney(value) : value);

/**
 * As linhas que o grafico mostra: so as que tem algo na medida escolhida (uma contraparte so de receita nao aparece
 * num grafico de despesas), da maior para a menor em valor absoluto. Empate pelo nome, para a ordem ser estavel.
 */
export function rankRows(rows: ReportRow[], measure: ReportMeasure, fallback: string): RankedItem[] {
  return rows
    .map((row) => ({
      key: row.id ?? "none",
      label: rowName(row, fallback),
      value: measureValue(row, measure),
      isOther: false,
    }))
    .filter((item) => !isZero(item.value))
    .sort((a, b) => Number(abs(b.value)) - Number(abs(a.value)) || a.label.localeCompare(b.label, "pt-BR"));
}

/**
 * Os `limit` maiores e, se sobrar mais de um grupo, o resto junto em "Outros". Com um so grupo a mais, ele aparece
 * com o proprio nome: "Outros" com uma unica linha esconderia o nome sem economizar nada.
 */
export function topWithOthers(items: RankedItem[], currencyCode: string, limit = TOP_LIMIT): RankedItem[] {
  if (items.length <= limit + 1) return items;
  const top = items.slice(0, limit);
  const rest = items.slice(limit);
  const total = sumMoney(
    rest.map((item) => item.value),
    placesOf(currencyCode),
  );
  return [...top, { key: "others", label: othersLabel(), value: total, isOther: true }];
}

/** Largura da barra (1 a 100) em relacao ao maior valor absoluto da lista; 0 se o valor e zero. */
export function barWidth(value: string, items: RankedItem[]): number {
  const max = items.reduce((top, item) => (Number(abs(item.value)) > Number(top) ? abs(item.value) : top), "0");
  return barPercent(abs(value), max);
}

// ---------- Mes ----------

/** Os pontos da linha: um por mes, ja na ordem do servidor (do mais antigo ao mais novo). */
export function monthPoints(block: MonthlyBlock, measure: ReportMeasure): ChartPoint[] {
  return block.months.map((point) => ({ x: point.month, value: measureValue(point, measure) }));
}

/** Os meses no formato das linhas da tabela de detalhamento (id e o mes, nome e o mes por extenso). */
export function monthRows(block: MonthlyBlock): ReportRow[] {
  return block.months.map((point) => ({
    id: point.month,
    name: longMonthLabel(point.month),
    income: point.income,
    expense: point.expense,
    net: point.net,
    count: point.count,
  }));
}

/** Os meses como barras, na ordem do tempo (nao do tamanho) e sem esconder os meses vazios. */
export function monthItems(block: MonthlyBlock, measure: ReportMeasure): RankedItem[] {
  return block.months.map((point) => ({
    key: point.month,
    label: shortMonthLabel(point.month),
    value: measureValue(point, measure),
    isOther: false,
  }));
}
