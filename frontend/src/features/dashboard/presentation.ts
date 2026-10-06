import type { BudgetProgress } from "@/api/budgets";
import type { NetWorthCurrency } from "@/api/dashboard";
import type { ReportRow, ReportTotals } from "@/api/reports";
import type { UpcomingItem } from "@/api/dashboard";
import type { DonutSlice, LineSeries } from "@/components/charts";
import type { Transaction } from "@/api/transactions";
import { progressState, WARNING_AT_PERCENT } from "@/features/budgets/presentation";
import {
  directionOf,
  formatTransactionAmount,
  transactionDate,
  transactionTitle,
  type Direction,
} from "@/features/transactions/presentation";
import { i18n, currentIntlLocale } from "@/i18n";
import { shiftDay } from "@/lib/dates";
import { formatMoney, isNegativeMoney, negateMoney, sumMoney } from "@/lib/money";

// Regras de calculo e formatacao do painel. Sem JSX aqui: so o que da para testar sem renderizar nada.

function isZeroMoney(value: string): boolean {
  return /^-?0(\.0+)?$/.test(value);
}

// ---------- Patrimonio ----------

/** Serie "net" de uma moeda, pronta para o LineChart (um ponto por mes). */
export function netWorthSeries(currency: NetWorthCurrency): LineSeries {
  return {
    key: currency.currency_code,
    label: i18n.t("dashboard.presentation.net"),
    points: currency.series.map((point) => ({ x: point.month, value: point.net })),
  };
}

// ---------- Este mes vs mes passado ----------

export type MonthMetric = "income" | "expense" | "net";

export type MonthComparison = {
  // current - previous, em texto decimal exato
  diff: string;
  // (diff / previous) * 100; null quando o mes passado foi zero (sem base de comparacao)
  percent: number | null;
};

/** Diferenca entre o valor deste mes e do mes passado. `previous` ausente conta como zero. */
export function compareToLastMonth(current: string, previous: string | undefined, places: number): MonthComparison {
  const base = previous ?? (places > 0 ? `0.${"0".repeat(places)}` : "0");
  const diff = sumMoney([current, negateMoney(base)], places);
  if (isZeroMoney(base)) return { diff, percent: null };
  return { diff, percent: (Number(diff) / Math.abs(Number(base))) * 100 };
}

export type Trend = "good" | "bad" | "neutral";

/** Para despesa, diminuir e bom; para receita e resultado, aumentar e bom. */
export function trendFor(metric: MonthMetric, diff: string): Trend {
  if (isZeroMoney(diff)) return "neutral";
  const negative = isNegativeMoney(diff);
  if (metric === "expense") return negative ? "good" : "bad";
  return negative ? "bad" : "good";
}

/** "R$ 120,00 a mais", "R$ 50,00 a menos" ou "Igual ao mês passado". */
export function formatDiff(diff: string, currencyCode: string): string {
  if (isZeroMoney(diff)) return i18n.t("dashboard.presentation.sameAsLastMonth");
  const negative = isNegativeMoney(diff);
  const amount = formatMoney(negative ? negateMoney(diff) : diff, currencyCode);
  return i18n.t(negative ? "dashboard.presentation.less" : "dashboard.presentation.more", { amount });
}

/** "+12,3%", "-5,0%" ou "Sem base de comparação" (mes passado zerado). */
export function formatPercent(percent: number | null): string {
  if (percent === null) return i18n.t("dashboard.presentation.noBase");
  const rounded = Math.round(percent * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString(currentIntlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Acha os totais da mesma moeda num outro periodo (o mes passado pode nao ter tido lancamentos nela). */
export function findByCurrency(list: ReportTotals[], currencyCode: string): ReportTotals | undefined {
  return list.find((item) => item.currency_code === currencyCode);
}

// ---------- Gastos por categoria ----------

/** Nomes de moeda presentes nos blocos, na ordem que vieram. */
export function currenciesOf(blocks: { currency_code: string }[]): string[] {
  return blocks.map((block) => block.currency_code);
}

/** Mantem a moeda escolhida se ela ainda existir; senao cai na primeira da lista. */
export function pickCurrency(blocks: { currency_code: string }[], selected: string | null): string | null {
  if (selected && blocks.some((block) => block.currency_code === selected)) return selected;
  return blocks[0]?.currency_code ?? null;
}

/** Fatias de despesa por categoria (so quem gastou alguma coisa; o DonutChart agrupa o resto em "Outras"). */
export function categorySlices(rows: ReportRow[], fallbackLabel: string): DonutSlice[] {
  return rows
    .filter((row) => !isZeroMoney(row.expense) && !isNegativeMoney(row.expense))
    .sort((a, b) => Number(b.expense) - Number(a.expense))
    .map((row) => ({ key: row.id ?? "__sem_categoria__", label: row.id === null ? fallbackLabel : row.name, value: row.expense }));
}

// ---------- Orcamentos ----------

/** Os mais perto do limite primeiro, ate `limit` itens. */
export function closestToLimit(items: BudgetProgress[], limit = 4): BudgetProgress[] {
  return [...items].sort((a, b) => b.percent - a.percent).slice(0, limit);
}

// ---------- Proximos vencimentos ----------

/** "R$ 49,90" quando min e max sao iguais; senao "R$ 40,00 a R$ 60,00". */
export function upcomingAmountText(item: Pick<UpcomingItem, "amount_min" | "amount_max" | "currency_code">): string {
  if (item.amount_min === item.amount_max) return formatMoney(item.amount_min, item.currency_code);
  return i18n.t("dashboard.presentation.range", {
    min: formatMoney(item.amount_min, item.currency_code),
    max: formatMoney(item.amount_max, item.currency_code),
  });
}

export function directionText(direction: UpcomingItem["direction"]): string {
  if (direction === "in") return i18n.t("dashboard.presentation.directionIn");
  if (direction === "out") return i18n.t("dashboard.presentation.directionOut");
  return i18n.t("dashboard.presentation.directionTransfer");
}

// ---------- Alertas ----------

export type DashboardAlert = { key: string; text: string; href: string; level: "warning" | "destructive" };

/** Contas atrasadas e orcamentos perto ou no limite, na ordem de mais para menos grave. */
export function buildAlerts(upcoming: UpcomingItem[], budgets: BudgetProgress[]): DashboardAlert[] {
  const overdue = upcoming.filter((item) => item.overdue).length;
  const over = budgets.filter((budget) => progressState(budget.percent) === "over").length;
  const warning = budgets.filter((budget) => progressState(budget.percent) === "warning").length;

  const alerts: DashboardAlert[] = [];
  if (overdue > 0) {
    alerts.push({
      key: "overdue",
      text: i18n.t("dashboard.presentation.overdue", { count: overdue }),
      href: "/contas-a-pagar",
      level: "destructive",
    });
  }
  if (over > 0) {
    alerts.push({
      key: "over",
      text: i18n.t("dashboard.presentation.overBudget", { count: over }),
      href: "/orcamentos",
      level: "destructive",
    });
  }
  if (warning > 0) {
    alerts.push({
      key: "warning",
      text: i18n.t("dashboard.presentation.nearLimit", { count: warning, percent: WARNING_AT_PERCENT }),
      href: "/orcamentos",
      level: "warning",
    });
  }
  return alerts;
}

// ---------- Ultimas transacoes (linha compacta) ----------

/** "Hoje", "Ontem", "13/03" (mesmo ano) ou "31/12/25" (outro ano): cabe numa coluna estreita. */
export function shortDayLabel(date: string, today: string): string {
  if (date === today) return i18n.t("dates.today");
  if (date === shiftDay(today, -1)) return i18n.t("dates.yesterday");
  const [year, month, day] = date.split("-").map(Number);
  // Dia e mes na ordem do idioma (13/03 em portugues, 03/13 em ingles); o ano so aparece quando e outro ano
  const sameYear = String(year) === today.slice(0, 4);
  return new Intl.DateTimeFormat(currentIntlLocale(), {
    day: "2-digit",
    month: "2-digit",
    ...(sameYear ? {} : { year: "2-digit" }),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export type RecentLine = {
  id: string;
  date: string;
  title: string;
  // Categoria, ou "Dividida em N"; vazio quando nao ha o que dizer
  detail: string | null;
  // Com sinal; null quando os splits nao somam de forma honesta (moedas ou sentidos diferentes)
  amount: string | null;
  direction: Direction;
};

/** Os dados de uma linha da lista "Ultimas transacoes" do painel. */
export function recentLine(
  transaction: Transaction,
  categories: Map<string, { name: string }>,
  today: string,
): RecentLine {
  const [first] = transaction.splits;
  const divided = transaction.splits.length > 1;
  // Na dividida cada parte pode ter a sua categoria, entao o detalhe diz so quantas partes sao
  const category = first?.category_id ? categories.get(first.category_id) : undefined;
  return {
    id: transaction.id,
    date: shortDayLabel(transactionDate(transaction), today),
    title: transactionTitle(transaction),
    detail: divided ? i18n.t("dashboard.presentation.dividedIn", { count: transaction.splits.length }) : (category?.name ?? null),
    amount: formatTransactionAmount(transaction),
    direction: first ? directionOf(first) : "neutral",
  };
}
