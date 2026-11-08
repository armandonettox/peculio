import { firstOfMonth, shiftDay, shiftMonth } from "./dates";

// Mes inteiro como par de datas "AAAA-MM-DD". O painel escolhe o mes e todos os blocos pedem o mesmo intervalo.

export type MonthRange = {
  // Primeiro dia do mes: serve de identificador do mes
  month: string;
  from: string;
  to: string;
};

/** O mes que contem a data. */
export function monthRange(date: string): MonthRange {
  const month = firstOfMonth(date);
  return { month, from: month, to: shiftDay(shiftMonth(month, 1), -1) };
}

/** O mes `months` meses depois (ou antes, se negativo). */
export function shiftMonthRange(range: MonthRange, months: number): MonthRange {
  return monthRange(shiftMonth(range.month, months));
}

/** Os `count` meses terminando no mes dado, do primeiro dia do mais antigo ao ultimo dia do mes dado. */
export function monthsEndingAt(range: MonthRange, count: number): { from: string; to: string } {
  return { from: shiftMonth(range.month, -(count - 1)), to: range.to };
}

/** Ano de um mes ("2026-11-01" vira 2026). */
export function yearOf(month: string): number {
  return Number(month.slice(0, 4));
}

/** O mesmo mes em outro ano, ou o primeiro dia do mes dado no ano indicado. */
export function withYear(month: string, year: number): string {
  return `${String(year).padStart(4, "0")}${month.slice(4)}`;
}
