import type { PlanRow } from "@/api/plans";
import { currentIntlLocale } from "@/i18n";
import { shiftDay, shiftMonth } from "@/lib/dates";

/** "2026-11-15" vira "2026-11": o formato do mes na API. */
export const monthKey = (date: string): string => date.slice(0, 7);

/** O dia 1 do mes "AAAA-MM". */
export const monthStart = (month: string): string => `${month}-01`;

/** O ultimo dia do mes de uma data "AAAA-MM-DD". */
export function lastOfMonth(date: string): string {
  return shiftDay(shiftMonth(date, 1), -1);
}

/** O mes (AAAA-MM) `months` meses antes ou depois. */
export const shiftMonthKey = (month: string, months: number): string => monthKey(shiftMonth(monthStart(month), months));

type Amounts = Pick<PlanRow, "planned" | "paid" | "expected">;

export type BarSegments = {
  // Porcentagens da largura da barra (somam 100 quando ha algum gasto ou limite)
  paidWithin: number;
  expectedWithin: number;
  paidOver: number;
  expectedOver: number;
};

/**
 * Os quatro trechos da barra de uma linha, como no Mobills: pago dentro do limite, previsto dentro do limite, pago que
 * passou do limite e previsto que passou. A barra cobre o maior entre o limite e o gasto, entao o estouro aparece sem
 * a barra transbordar.
 */
export function barSegments({ planned, paid, expected }: Amounts): BarSegments {
  const limit = Number(planned);
  const paidValue = Number(paid);
  const expectedValue = Number(expected);
  const scale = Math.max(limit, paidValue + expectedValue);
  if (scale <= 0) return { paidWithin: 0, expectedWithin: 0, paidOver: 0, expectedOver: 0 };

  const paidWithin = Math.min(paidValue, limit);
  const expectedWithin = Math.min(expectedValue, Math.max(limit - paidValue, 0));
  const paidOver = Math.max(paidValue - limit, 0);
  const expectedOver = expectedValue - expectedWithin;
  const pct = (value: number) => (value / scale) * 100;
  return {
    paidWithin: pct(paidWithin),
    expectedWithin: pct(expectedWithin),
    paidOver: pct(paidOver),
    expectedOver: pct(expectedOver),
  };
}

/** Quanto `part` e do limite, em porcentagem; null quando nao ha limite para comparar. */
export function percentOfLimit(part: string, limit: string): number | null {
  const base = Number(limit);
  if (!(base > 0)) return null;
  return (Number(part) / base) * 100;
}

/** "0,67%", "12%", "100%": ate duas casas, sem zeros sobrando. */
export function formatPercent(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat(currentIntlLocale(), { style: "percent", maximumFractionDigits: 2 }).format(value / 100);
}

/** O valor "passou" do limite quando o restante e negativo. */
export const isOver = (remaining: string): boolean => Number(remaining) < 0;
