import type { ChartColor } from "./types";

// Todos os nomes de cor, na ordem em que entram quando o grafico escolhe sozinho
export const CHART_COLOR_NAMES: readonly ChartColor[] = ["primary", "accent", "warning", "negative", "muted", "positive"];

// Cada cor aponta para um token do index.css (claro e escuro), nunca para um hex
export function chartColorVar(color: ChartColor): string {
  return `var(--chart-${color})`;
}

// Cor de quem nao informou uma: revezam as da lista, de forma estavel pela posicao
export function pickColor(color: ChartColor | undefined, index: number): ChartColor {
  if (color) return color;
  const safe = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return CHART_COLOR_NAMES[safe % CHART_COLOR_NAMES.length];
}
