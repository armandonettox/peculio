import { currentIntlLocale, i18n } from "@/i18n";

// Datas do dia a dia. Os lancamentos usam so a data ("2026-03-12"), sem hora nem fuso.

// Hoje: o dia do servidor, no fuso do app (ver app-clock.ts)
export { appToday } from "./app-clock";

function parts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);
  return [year, month, day];
}

/** Soma (ou subtrai) dias de uma data "AAAA-MM-DD". Usa UTC para o horario de verao nao interferir. */
export function shiftDay(date: string, days: number): string {
  const [year, month, day] = parts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** "Hoje", "Ontem" ou "Quinta-feira, 12 de março de 2026" (e "Thursday, March 12, 2026" em inglês). */
export function formatDayHeading(date: string, today: string): string {
  if (date === today) return i18n.t("dates.today");
  if (date === shiftDay(today, -1)) return i18n.t("dates.yesterday");
  const [year, month, day] = parts(date);
  const text = new Intl.DateTimeFormat(currentIntlLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Primeiro dia do mes de uma data "AAAA-MM-DD". */
export function firstOfMonth(date: string): string {
  const [year, month] = parts(date);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Primeiro dia do mes `months` meses depois (ou antes, se negativo) do mes da data. */
export function shiftMonth(date: string, months: number): string {
  const [year, month] = parts(date);
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
}

/** "Marco de 2026". */
export function formatMonthYear(date: string): string {
  const [year, month] = parts(date);
  const text = new Intl.DateTimeFormat(currentIntlLocale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return text.replace(/^./, (letter) => letter.toUpperCase());
}

/** Data numerica na ordem do idioma ("05/03/2026" em portugues, "03/05/2026" em ingles). `withYear` poe o ano. */
function numericDay(date: string, withYear: boolean): string {
  const [year, month, day] = parts(date);
  return new Intl.DateTimeFormat(currentIntlLocale(), {
    day: "2-digit",
    month: "2-digit",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** "09/03 a 15/03"; com o ano nas duas pontas quando o periodo muda de ano ("29/12/2025 a 04/01/2026"). */
export function formatDateRange(start: string, end: string): string {
  const withYear = parts(start)[0] !== parts(end)[0];
  return i18n.t("dates.range", { start: numericDay(start, withYear), end: numericDay(end, withYear) });
}

/** "05/03/2026" (e "03/05/2026" em ingles). */
export function formatDate(date: string): string {
  return numericDay(date, true);
}

/** Dias de `from` ate `to` (positivo se `to` e depois; negativo se antes). */
export function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = parts(from);
  const [toYear, toMonth, toDay] = parts(to);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000);
}
