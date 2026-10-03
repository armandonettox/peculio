import { parseDecimal, round2, sumDecimals } from "./chart-numbers";
import type { ChartColor, DonutSlice } from "./types";

// Geometria da rosca: agrupamento das fatias, percentuais e arcos. Funcoes puras.

export const OTHER_KEY = "__other__";
export const DEFAULT_MAX_SLICES = 6;

export type DonutItem = {
  key: string;
  label: string;
  // Texto decimal (a soma de "Outras" tambem e exata, sem float)
  value: string;
  // Valor numerico, so para a geometria
  amount: number;
  color?: ChartColor;
  isOther: boolean;
};

/**
 * Fatias que aparecem: ignora zero, negativo e texto invalido, ordena da maior para a menor e, se passar
 * de `maxSlices`, junta as menores em uma fatia "Outras" (que conta dentro do limite). Minimo 2.
 */
export function groupSlices(slices: DonutSlice[], maxSlices: number, otherLabel: string): DonutItem[] {
  const positive = slices
    .map((slice) => ({ ...slice, amount: parseDecimal(slice.value), isOther: false }))
    .filter((slice) => slice.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const limit = Number.isFinite(maxSlices) ? Math.max(2, Math.floor(maxSlices)) : DEFAULT_MAX_SLICES;
  if (positive.length <= limit) return positive;

  const top = positive.slice(0, limit - 1);
  const rest = positive.slice(limit - 1);
  const restValue = sumDecimals(rest.map((slice) => slice.value));
  return [
    ...top,
    { key: OTHER_KEY, label: otherLabel, value: restValue, amount: parseDecimal(restValue), color: "muted", isOther: true },
  ];
}

/**
 * Percentuais inteiros que somam exatamente 100 (maior resto): arredondar cada um separado
 * poderia mostrar 99 ou 101 na legenda.
 */
export function roundedPercents(amounts: number[]): number[] {
  const total = amounts.reduce((sum, amount) => sum + (amount > 0 ? amount : 0), 0);
  if (total <= 0) return amounts.map(() => 0);
  const exact = amounts.map((amount) => ((amount > 0 ? amount : 0) / total) * 100);
  const floors = exact.map((value) => Math.floor(value + 1e-9));
  let missing = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value + 1e-9) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (missing <= 0) break;
    floors[index] += 1;
    missing -= 1;
  }
  return floors;
}

export type Arc = { start: number; end: number };

// Angulos (radianos) de cada fatia, a partir do topo e no sentido horario
export function sliceAngles(amounts: number[]): Arc[] {
  const total = amounts.reduce((sum, amount) => sum + (amount > 0 ? amount : 0), 0);
  let cursor = -Math.PI / 2;
  return amounts.map((amount) => {
    const sweep = total > 0 && amount > 0 ? (amount / total) * Math.PI * 2 : 0;
    const arc = { start: cursor, end: cursor + sweep };
    cursor += sweep;
    return arc;
  });
}

function point(cx: number, cy: number, radius: number, angle: number): string {
  return `${round2(cx + radius * Math.cos(angle))} ${round2(cy + radius * Math.sin(angle))}`;
}

/**
 * Fatia de anel entre `inner` e `outer`. Um arco de 360 graus tem inicio e fim no mesmo ponto e o SVG
 * o descarta; nesse caso o anel inteiro vira dois semicirculos por contorno (use fill-rule evenodd).
 */
export function ringSlicePath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const sweep = end - start;
  if (!(sweep > 0)) return "";
  if (sweep >= Math.PI * 2 - 1e-9) {
    const o = round2(outer);
    const i = round2(inner);
    return (
      `M${round2(cx + o)} ${round2(cy)} A${o} ${o} 0 1 1 ${round2(cx - o)} ${round2(cy)} A${o} ${o} 0 1 1 ${round2(cx + o)} ${round2(cy)} Z ` +
      `M${round2(cx + i)} ${round2(cy)} A${i} ${i} 0 1 0 ${round2(cx - i)} ${round2(cy)} A${i} ${i} 0 1 0 ${round2(cx + i)} ${round2(cy)} Z`
    );
  }
  const large = sweep > Math.PI ? 1 : 0;
  const o = round2(outer);
  const i = round2(inner);
  return `M${point(cx, cy, outer, start)} A${o} ${o} 0 ${large} 1 ${point(cx, cy, outer, end)} L${point(cx, cy, inner, end)} A${i} ${i} 0 ${large} 0 ${point(cx, cy, inner, start)} Z`;
}

// Ponto no meio da fatia, a um raio dado: ancora do balao
export function arcMidpoint(cx: number, cy: number, radius: number, arc: Arc): { x: number; y: number } {
  const angle = (arc.start + arc.end) / 2;
  return { x: round2(cx + radius * Math.cos(angle)), y: round2(cy + radius * Math.sin(angle)) };
}
