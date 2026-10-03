import { round2 } from "./chart-numbers";

// Geometria do grafico de linha e da sparkline: so funcoes puras, sem React.

export type Pt = { x: number; y: number };

// Eixo X compartilhado: todos os `x` das series, sem repetir, em ordem (ISO ordena como texto)
export function buildXValues(series: { points: { x: string }[] }[]): string[] {
  const seen = new Set<string>();
  for (const item of series) for (const point of item.points) seen.add(point.x);
  return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function valid(point: Pt | null): point is Pt {
  return point !== null && Number.isFinite(point.x) && Number.isFinite(point.y);
}

// Trechos continuos: um ponto ausente (null) interrompe a linha em vez de ligar os vizinhos
export function splitSegments(points: (Pt | null)[]): Pt[][] {
  const segments: Pt[][] = [];
  let current: Pt[] = [];
  for (const point of points) {
    if (valid(point)) current.push(point);
    else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export function linePath(points: (Pt | null)[]): string {
  return splitSegments(points)
    .filter((segment) => segment.length > 1)
    .map((segment) => segment.map((p, i) => `${i === 0 ? "M" : "L"}${round2(p.x)} ${round2(p.y)}`).join(" "))
    .join(" ");
}

// Area sob a linha ate a linha de base (o zero, ou a borda de baixo quando o zero esta fora)
export function areaPath(points: (Pt | null)[], baselineY: number): string {
  const base = round2(baselineY);
  return splitSegments(points)
    .filter((segment) => segment.length > 1)
    .map((segment) => {
      const first = segment[0];
      const last = segment[segment.length - 1];
      const edge = segment.map((p) => `L${round2(p.x)} ${round2(p.y)}`).join(" ");
      return `M${round2(first.x)} ${base} ${edge} L${round2(last.x)} ${base} Z`;
    })
    .join(" ");
}

// Largura aproximada de um texto, para reservar margem e afinar rotulos (sem medir o DOM)
export function estimateTextWidth(text: string, fontSize: number): number {
  return Math.ceil(text.length * fontSize * 0.58);
}

/**
 * Quais rotulos do eixo X mostrar sem que um encoste no outro. `widths` e a largura de cada rotulo,
 * `pitch` a distancia entre dois pontos vizinhos. O ultimo (mais recente) sempre aparece e os demais
 * voltam de passo em passo a partir dele. Devolve indices em ordem crescente.
 */
export function thinLabelIndexes(widths: number[], pitch: number, gap = 8): number[] {
  const count = widths.length;
  if (count === 0) return [];
  if (!(pitch > 0)) return [count - 1];
  const widest = widths.reduce((top, width) => Math.max(top, width), 0);
  const step = Math.max(1, Math.ceil((widest + gap) / pitch));
  const indexes: number[] = [];
  for (let i = count - 1; i >= 0; i -= step) indexes.push(i);
  return indexes.reverse();
}

export const MARKER_SHAPES = ["circle", "square", "diamond", "triangle"] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

// Marcadores por posicao da serie: com mais de uma serie, a forma ajuda quem nao distingue as cores
export function markerShape(index: number): MarkerShape {
  const safe = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return MARKER_SHAPES[safe % MARKER_SHAPES.length];
}

export function markerPath(shape: MarkerShape, cx: number, cy: number, r: number): string {
  const x = round2(cx);
  const y = round2(cy);
  const s = round2(r);
  switch (shape) {
    case "circle":
      return `M${round2(x - s)} ${y} A${s} ${s} 0 1 0 ${round2(x + s)} ${y} A${s} ${s} 0 1 0 ${round2(x - s)} ${y} Z`;
    case "square":
      return `M${round2(x - s)} ${round2(y - s)} H${round2(x + s)} V${round2(y + s)} H${round2(x - s)} Z`;
    case "diamond":
      return `M${x} ${round2(y - s * 1.3)} L${round2(x + s * 1.3)} ${y} L${x} ${round2(y + s * 1.3)} L${round2(x - s * 1.3)} ${y} Z`;
    case "triangle":
      return `M${x} ${round2(y - s * 1.2)} L${round2(x + s * 1.2)} ${round2(y + s)} L${round2(x - s * 1.2)} ${round2(y + s)} Z`;
  }
}

// Tracejados por posicao da serie: a primeira e solida (com uma serie so, nao ha o que distinguir)
const DASHES = ["", "6 4", "2 3", "10 3 2 3"];
export function dashPattern(index: number): string {
  const safe = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return DASHES[safe % DASHES.length];
}

export type TooltipPlacement = { horizontal: "start" | "center" | "end"; vertical: "above" | "below" };

// Onde ancorar o balao em relacao ao ponto, para ele nao sair da area do grafico
export function tooltipPlacement(x: number, y: number, width: number): TooltipPlacement {
  const horizontal = x < width * 0.2 ? "start" : x > width * 0.8 ? "end" : "center";
  const vertical = y < 48 ? "below" : "above";
  return { horizontal, vertical };
}

// Pontos da sparkline em uma caixa width x height com margem pad. Sem dado devolve []
export function sparklinePoints(values: number[], width: number, height: number, pad: number): Pt[] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return [];
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const innerWidth = width - 2 * pad;
  const innerHeight = height - 2 * pad;
  return finite.map((value, index) => ({
    x: finite.length === 1 ? width / 2 : pad + (index / (finite.length - 1)) * innerWidth,
    y: high === low ? height / 2 : pad + (1 - (value - low) / (high - low)) * innerHeight,
  }));
}
