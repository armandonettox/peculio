import { expect } from "vitest";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// Formatadores de teste: parecidos com os do app, mas sem depender dele
export function formatMoneyTest(value: string): string {
  const parsed = Number(value);
  // Texto invalido vira zero, como o formatador real faria; o grafico so repassa o texto
  const number = Number.isFinite(parsed) ? parsed : 0;
  const [whole, fraction] = Math.abs(number).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${number < 0 ? "-" : ""}R$ ${grouped},${fraction}`;
}

export function formatMonthTest(x: string): string {
  const [year, month] = x.split("-");
  return `${MONTHS[Number(month) - 1]}/${year.slice(2)}`;
}

// Meses consecutivos a partir de 2024-01
export function monthKeys(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const month = (i % 12) + 1;
    const year = 2024 + Math.floor(i / 12);
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

// Nenhum atributo ou texto do desenho pode ter NaN ou Infinity
export function expectNoBrokenNumbers(container: HTMLElement) {
  const html = container.innerHTML;
  expect(html).not.toMatch(/NaN/);
  expect(html).not.toMatch(/Infinity/);
}
