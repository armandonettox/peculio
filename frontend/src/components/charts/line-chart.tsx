import { useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { chartColorVar, pickColor } from "./chart-colors";
import { firstGridPoint, nextGridPoint, type GridPoint } from "./chart-keyboard";
import { parseDecimal, round2, toDecimalText } from "./chart-numbers";
import { ChartTable, ChartTooltip, EmptyChart } from "./chart-parts";
import { linearScale, niceTicks } from "./chart-scale";
import {
  areaPath,
  buildXValues,
  dashPattern,
  estimateTextWidth,
  linePath,
  markerPath,
  markerShape,
  thinLabelIndexes,
  tooltipPlacement,
  type Pt,
} from "./line-geometry";
import type { LineChartProps } from "./types";
import { useContainerWidth } from "./use-container-width";

const FONT_SIZE = 11;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 28;
const MARGIN_RIGHT = 24;
const INNER_PAD = 10;
const MARKER_RADIUS = 3.5;

/**
 * Grafico de linhas em SVG, sem biblioteca. O desenho (role img) e o resumo para leitor de tela;
 * os pontos ficam numa camada acima, focaveis por teclado, e a tabela equivalente fica oculta (sr-only).
 */
export function LineChart({ title, description, series, formatValue, formatX, height = 220, area = false, className }: LineChartProps) {
  const descriptionId = useId();
  const keysHintId = useId();
  const { ref, width } = useContainerWidth<HTMLDivElement>();
  const [active, setActive] = useState<{ seriesIndex: number; xIndex: number } | null>(null);
  // Uma parada de Tab so: o ultimo ponto focado (ou o primeiro). As setas percorrem os demais.
  const [tabStop, setTabStop] = useState<GridPoint | null>(null);
  const pointRefs = useRef(new Map<string, SVGPathElement>());

  const xs = buildXValues(series);
  if (xs.length === 0) return <EmptyChart label={title} kind="line" className={className} />;

  // Valor de cada serie em cada x (null quando a serie nao tem ponto naquele x)
  const lookups = series.map((item) => {
    const byX = new Map<string, string>();
    for (const point of item.points) byX.set(point.x, point.value);
    return xs.map((x) => byX.get(x) ?? null);
  });
  const numbers = lookups.flatMap((values) => values.flatMap((text) => (text === null ? [] : [parseDecimal(text)])));
  const ticks = niceTicks(Math.min(...numbers), Math.max(...numbers));
  const hasNegative = numbers.some((value) => value < 0);

  const tickLabels = ticks.ticks.map((tick) => formatValue(toDecimalText(tick)));
  const labelWidth = tickLabels.reduce((top, label) => Math.max(top, estimateTextWidth(label, FONT_SIZE)), 0);
  const marginLeft = Math.min(120, Math.max(40, labelWidth + 14));

  const plotLeft = marginLeft;
  const plotRight = width - MARGIN_RIGHT;
  const plotTop = MARGIN_TOP;
  const plotBottom = height - MARGIN_BOTTOM;
  const yScale = linearScale(ticks.min, ticks.max, plotBottom, plotTop);
  const pitch = xs.length > 1 ? (plotRight - plotLeft - 2 * INNER_PAD) / (xs.length - 1) : 0;
  const xAt = (index: number) => (xs.length === 1 ? (plotLeft + plotRight) / 2 : plotLeft + INNER_PAD + index * pitch);

  const xLabels = xs.map((x) => formatX(x));
  const shownLabels = new Set(thinLabelIndexes(xLabels.map((label) => estimateTextWidth(label, FONT_SIZE)), pitch));

  const multi = series.length > 1;
  const seriesPoints: (Pt | null)[][] = lookups.map((values) =>
    values.map((text, index) => (text === null ? null : { x: xAt(index), y: yScale(parseDecimal(text)) })),
  );

  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const summary =
    `${title}. ${count(series.length, "série", "séries")}, ${count(xs.length, "período", "períodos")}, ` +
    `de ${xLabels[0]} a ${xLabels[xs.length - 1]}. ` +
    `Valores de ${formatValue(toDecimalText(Math.min(...numbers)))} a ${formatValue(toDecimalText(Math.max(...numbers)))}.`;

  const pointLabel = (seriesIndex: number, xIndex: number) =>
    multi ? `${series[seriesIndex].label}, ${xLabels[xIndex]}` : xLabels[xIndex];
  const pointValue = (seriesIndex: number, xIndex: number) => formatValue(lookups[seriesIndex][xIndex] ?? "0");

  const activePoint = active ? seriesPoints[active.seriesIndex]?.[active.xIndex] : null;
  const presence = seriesPoints.map((points) => points.map((point) => point !== null));
  // Se os dados mudaram e o ponto lembrado deixou de existir, volta ao primeiro
  const stop = tabStop && presence[tabStop.seriesIndex]?.[tabStop.xIndex] ? tabStop : firstGridPoint(presence);
  const manyPoints = presence.flat().filter(Boolean).length > 1;
  const zeroY = yScale(Math.min(Math.max(0, ticks.min), ticks.max));

  return (
    <div data-chart="line" className={cn("flex flex-col gap-2", className)}>
      {description ? (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      ) : null}

      {manyPoints ? (
        <span id={keysHintId} className="sr-only">
          Use as setas do teclado para percorrer os pontos, Home e End para ir ao primeiro e ao último.
        </span>
      ) : null}

      <div ref={ref} className="relative">
        <svg
          role="img"
          aria-label={summary}
          aria-describedby={description ? descriptionId : undefined}
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
        >
          {ticks.ticks.map((tick, index) => {
            const y = round2(yScale(tick));
            const isZeroLine = hasNegative && tick === 0;
            return (
              <g key={tick}>
                <line
                  x1={round2(plotLeft)}
                  x2={round2(plotRight)}
                  y1={y}
                  y2={y}
                  strokeWidth={isZeroLine ? 1.5 : 1}
                  className={isZeroLine ? "stroke-muted-foreground" : "stroke-border"}
                  data-zero-line={isZeroLine ? "true" : undefined}
                />
                <text x={round2(plotLeft - 8)} y={round2(y + 4)} textAnchor="end" fontSize={FONT_SIZE} className="fill-muted-foreground">
                  {tickLabels[index]}
                </text>
              </g>
            );
          })}

          {xs.map((x, index) =>
            shownLabels.has(index) ? (
              <text
                key={x}
                x={round2(xAt(index))}
                y={round2(plotBottom + 18)}
                textAnchor="middle"
                fontSize={FONT_SIZE}
                className="fill-muted-foreground"
              >
                {xLabels[index]}
              </text>
            ) : null,
          )}

          {area && series[0] ? (
            <path
              d={areaPath(seriesPoints[0], zeroY)}
              data-area="true"
              style={{ fill: chartColorVar(pickColor(series[0].color, 0)) }}
              fillOpacity={0.12}
              stroke="none"
            />
          ) : null}

          {series.map((item, seriesIndex) => (
            <path
              key={item.key}
              d={linePath(seriesPoints[seriesIndex])}
              data-series={item.key}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={dashPattern(seriesIndex) || undefined}
              style={{ stroke: chartColorVar(pickColor(item.color, seriesIndex)) }}
            />
          ))}
        </svg>

        <svg
          role="group"
          aria-label={`Pontos de ${title}`}
          aria-describedby={manyPoints ? keysHintId : undefined}
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="pointer-events-none absolute inset-0 block"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setActive(null);
              return;
            }
            const seriesIndex = Number(event.target instanceof Element ? event.target.getAttribute("data-si") : NaN);
            const xIndex = Number(event.target instanceof Element ? event.target.getAttribute("data-xi") : NaN);
            if (Number.isNaN(seriesIndex) || Number.isNaN(xIndex)) return;
            const next = nextGridPoint(presence, { seriesIndex, xIndex }, event.key);
            if (!next) return;
            event.preventDefault();
            pointRefs.current.get(`${next.seriesIndex}:${next.xIndex}`)?.focus();
          }}
        >
          {series.map((item, seriesIndex) =>
            seriesPoints[seriesIndex].map((point, xIndex) => {
              if (!point) return null;
              const color = chartColorVar(pickColor(item.color, seriesIndex));
              const shape = markerShape(seriesIndex);
              return (
                <path
                  key={`${item.key}:${xs[xIndex]}`}
                  d={markerPath(shape, point.x, point.y, MARKER_RADIUS)}
                  ref={(element) => {
                    if (element) pointRefs.current.set(`${seriesIndex}:${xIndex}`, element);
                    else pointRefs.current.delete(`${seriesIndex}:${xIndex}`);
                  }}
                  tabIndex={stop && stop.seriesIndex === seriesIndex && stop.xIndex === xIndex ? 0 : -1}
                  aria-label={`${pointLabel(seriesIndex, xIndex)}: ${pointValue(seriesIndex, xIndex)}`}
                  data-point={`${item.key}:${xs[xIndex]}`}
                  data-si={seriesIndex}
                  data-xi={xIndex}
                  className="pointer-events-auto cursor-pointer outline-none"
                  style={{ fill: color }}
                  stroke="transparent"
                  strokeWidth={12}
                  onFocus={() => {
                    setActive({ seriesIndex, xIndex });
                    setTabStop({ seriesIndex, xIndex });
                  }}
                  onBlur={() => setActive(null)}
                  onMouseEnter={() => setActive({ seriesIndex, xIndex })}
                  onMouseLeave={() => setActive(null)}
                />
              );
            }),
          )}
          {activePoint ? (
            <circle
              cx={round2(activePoint.x)}
              cy={round2(activePoint.y)}
              r={9}
              fill="none"
              strokeWidth={2}
              aria-hidden="true"
              className="stroke-foreground"
            />
          ) : null}
        </svg>

        {active && activePoint ? (
          <ChartTooltip
            leftPercent={round2((activePoint.x / width) * 100)}
            topPercent={round2((activePoint.y / height) * 100)}
            placement={tooltipPlacement(activePoint.x, activePoint.y, width)}
          >
            <div className="text-muted-foreground">{pointLabel(active.seriesIndex, active.xIndex)}</div>
            <div className="font-medium tabular-nums">{pointValue(active.seriesIndex, active.xIndex)}</div>
          </ChartTooltip>
        ) : null}
      </div>

      <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((item, seriesIndex) => {
          const color = chartColorVar(pickColor(item.color, seriesIndex));
          return (
            <li key={item.key} className="flex items-center gap-1.5" data-legend={item.key}>
              <svg width={26} height={12} viewBox="0 0 26 12" aria-hidden="true">
                <line
                  x1={0}
                  x2={26}
                  y1={6}
                  y2={6}
                  strokeWidth={2}
                  strokeDasharray={dashPattern(seriesIndex) || undefined}
                  style={{ stroke: color }}
                />
                <path d={markerPath(markerShape(seriesIndex), 13, 6, 3.5)} style={{ fill: color }} />
              </svg>
              {item.label}
            </li>
          );
        })}
      </ul>

      <ChartTable
        caption={title}
        headers={["Período", ...series.map((item) => item.label)]}
        rows={xs.map((x, xIndex) => ({
          header: xLabels[xIndex],
          cells: lookups.map((values) => (values[xIndex] === null ? "Sem dado" : formatValue(values[xIndex] as string))),
        }))}
      />
    </div>
  );
}
