import { currentIntlLocale } from "@/i18n";
import type { GroupedDimension, ReportRow } from "@/api/reports";
import { isNegativeMoney } from "@/lib/money";

export const DIMENSIONS: {
  key: GroupedDimension;
  title: string;
  column: string;
  // Texto da linha sem categoria, orcamento ou tag (o backend manda id nulo)
  fallback: string;
  note?: string;
}[] = [
  { key: "category", title: "Por categoria", column: "Categoria", fallback: "Sem categoria" },
  {
    key: "tag",
    title: "Por tag",
    column: "Tag",
    fallback: "Sem tag",
    note: "Um lançamento com várias tags aparece em cada uma delas, então a soma das linhas pode passar do total.",
  },
  { key: "budget", title: "Por orçamento", column: "Orçamento", fallback: "Sem orçamento" },
  { key: "account", title: "Por conta", column: "Conta", fallback: "Sem conta" },
];

export function rowName(row: ReportRow, fallback: string): string {
  return row.id === null ? fallback : row.name;
}

/** Largura da barra (0 a 100) em relacao ao maior valor da lista. So desenho: o dinheiro nunca e somado assim. */
export function barPercent(value: string, max: string): number {
  const top = Number(max);
  const current = Number(value);
  if (!(top > 0) || !(current > 0)) return 0;
  return Math.max(1, Math.round((current / top) * 100));
}

/** Verde para resultado positivo ou zero, vermelho para negativo. */
export function netClass(net: string): string {
  return isNegativeMoney(net) ? "text-destructive" : "text-positive";
}

/** "2026-03" -> "mar/26". */
export function shortMonthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  const text = new Intl.DateTimeFormat(currentIntlLocale(), { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, number - 1, 1)))
    .replace(".", "");
  return `${text}/${String(year).slice(2)}`;
}

/** "2026-03" -> "março de 2026", para leitor de tela e tabela. */
export function longMonthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(currentIntlLocale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, number - 1, 1)),
  );
}
