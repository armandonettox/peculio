// Datas do dia a dia. Os lancamentos usam so a data ("2026-03-12"), sem hora nem fuso.

// Hoje no fuso do usuario (toISOString usaria UTC e viraria o dia perto da meia-noite)
export const todayLocal = () => new Date().toLocaleDateString("sv-SE");

function parts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);
  return [year, month, day];
}

/** Soma (ou subtrai) dias de uma data "AAAA-MM-DD". Usa UTC para o horario de verao nao interferir. */
export function shiftDay(date: string, days: number): string {
  const [year, month, day] = parts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** "Hoje", "Ontem" ou "Quinta-feira, 12 de marco de 2026". */
export function formatDayHeading(date: string, today: string): string {
  if (date === today) return "Hoje";
  if (date === shiftDay(today, -1)) return "Ontem";
  const [year, month, day] = parts(date);
  const text = new Intl.DateTimeFormat("pt-BR", {
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
  const text = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return text.replace(/^./, (letter) => letter.toUpperCase());
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "09/03 a 15/03"; com o ano nas duas pontas quando o periodo muda de ano ("29/12/2025 a 04/01/2026"). */
export function formatDateRange(start: string, end: string): string {
  const [startYear, startMonth, startDay] = parts(start);
  const [endYear, endMonth, endDay] = parts(end);
  if (startYear !== endYear) {
    return `${pad(startDay)}/${pad(startMonth)}/${startYear} a ${pad(endDay)}/${pad(endMonth)}/${endYear}`;
  }
  return `${pad(startDay)}/${pad(startMonth)} a ${pad(endDay)}/${pad(endMonth)}`;
}
