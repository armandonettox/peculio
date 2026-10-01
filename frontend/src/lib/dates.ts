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
