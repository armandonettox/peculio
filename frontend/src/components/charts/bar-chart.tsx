import { useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { chartColorVar, pickColor } from "./chart-colors";
import { firstGridPoint, nextGridPoint, type GridPoint } from "./chart-keyboard";
import { parseDecimal, round2, toDecimalText } from "./chart-numbers";
import { ChartTable, ChartTooltip, EmptyChart } from "./chart-parts";
import { linearScale, niceTicks } from "./chart-scale";
import { buildXValues, estimateTextWidth, thinLabelIndexes, tooltipPlacement } from "./line-geometry";
import type { LineChartProps } from "./types";
import { useContainerWidth } from "./use-container-width";

const FONT_SIZE = 11;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 28;
const MARGIN_RIGHT = 24;
const BAR_GAP_RATIO = 0.25; // fracao da largura total por periodo que vira espaco entre barras

/**
 * Grafico de barras verticais em SVG, sem biblioteca.
 * Aceita as mesmas props que LineChart para ser intercambivel.
 */
export function BarChart({ title, description, series, formatValue, formatX, height = 220, className }: LineChartProps) {
  const keysHintId = useId();
  const { ref, width } = useContainerWidth<HTMLDivElement>();
  const [active, setActive] = useState<{ seriesIndex: number; xIndex: number } | null>(null);
  const [tabStop, setTabStop] = useState<GridPoint | null>(null);
  const pointRefs = useRef(new Map<string, SVGRectElement>());

  const xs = buildXValues(series);
  if (xs.length === 0) return <EmptyChart label={title} kind="line" className={className} />;

  const lookups = series.map((item) => {
    const byX = new Map<string, string>();
    for (const point of item.points) byX.set(point.x, point.value);
    return xs.map((x) => byX.get(x) ?? null);
  });

  const numbers = lookups.flatMap((values) => values.flatMap((text) => (text === null ? [] : [parseDecimal(text)])));
  // Barra mede tamanho: o eixo sempre inclui o zero (sem isso, valores de 490 a 800 comecavam a barra em 400
  // e a diferenca entre as barras parecia muito maior do que e)
  const ticks = niceTicks(Math.min(0, ...numbers), Math.max(0, ...numbers));
  const hasNegative = numbers.some((v) => v < 0);

  const tickLabels = ticks.ticks.map((tick) => formatValue(toDecimalText(tick)));
  const labelWidth = tickLabels.reduce((top, label) => Math.max(top, estimateTextWidth(label, FONT_SIZE)), 0);
  const marginLeft = Math.min(120, Math.max(40, labelWidth + 14));

  const plotLeft = marginLeft;
  const plotRight = width - MARGIN_RIGHT;
  const plotTop = MARGIN_TOP;
  const plotBottom = height - MARGIN_BOTTOM;
  const yScale = linearScale(ticks.min, ticks.max, plotBottom, plotTop);
  const zeroY = round2(yScale(Math.min(Math.max(0, ticks.min), ticks.max)));

  const totalWidth = plotRight - plotLeft;
  const slotWidth = xs.length > 0 ? totalWidth / xs.length : totalWidth;
  const groupWidth = slotWidth * (1 - BAR_GAP_RATIO);
  const barWidth = series.length > 0 ? groupWidth / series.length : groupWidth;

  const xLabels = xs.map((x) => formatX(x));
  const shownLabels = new Set(thinLabelIndexes(xLabels.map((label) => estimateTextWidth(label, FONT_SIZE)), slotWidth));

  const slotCenterX = (xIndex: number) => round2(plotLeft + (xIndex + 0.5) * slotWidth);
  const barX = (xIndex: number, seriesIndex: number) =>
    round2(plotLeft + xIndex * slotWidth + slotWidth * (BAR_GAP_RATIO / 2) + seriesIndex * barWidth);

  const presence = lookups.map((values) => values.map((text) => text !== null));
  const stop = tabStop && presence[tabStop.seriesIndex]?.[tabStop.xIndex] ? tabStop : firstGridPoint(presence);
  const manyPoints = presence.flat().filter(Boolean).length > 1;

  const activeValue =
    active !== null ? (lookups[active.seriesIndex][active.xIndex] ?? null) : null;
  const activePt =
    active !== null && activeValue !== null
      ? { x: slotCenterX(active.xIndex), y: round2(yScale(parseDecimal(activeValue))) }
      : null;

  const pointLabel = (seriesIndex: number, xIndex: number) =>
    series.length > 1 ? `${series[seriesIndex].label}, ${xLabels[xIndex]}` : xLabels[xIndex];
  const pointValue = (seriesIndex: number, xIndex: number) => formatValue(lookups[seriesIndex][xIndex] ?? "0");

  return (
    <div data-chart="bar" className={cn("flex flex-col gap-2", className)}>
      {description ? <span className="sr-only">{description}</span> : null}
      {manyPoints ? (
        <span id={keysHintId} className="sr-only">
          Use as setas do teclado para percorrer os pontos, Home e End para ir ao primeiro e ao último.
        </span>
      ) : null}

      <div ref={ref} className="relative">
        <svg
          role="img"
          aria-label={title}
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
        >
          {/* linhas de grade e rotulos do eixo Y */}
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
                />
                <text
                  x={round2(plotLeft - 8)}
                  y={round2(y + 4)}
                  textAnchor="end"
                  fontSize={FONT_SIZE}
                  className="fill-muted-foreground"
                >
                  {tickLabels[index]}
                </text>
              </g>
            );
          })}

          {/* rotulos do eixo X */}
          {xs.map((x, index) =>
            shownLabels.has(index) ? (
              <text
                key={x}
                x={slotCenterX(index)}
                y={round2(plotBottom + 18)}
                textAnchor="middle"
                fontSize={FONT_SIZE}
                className="fill-muted-foreground"
              >
                {xLabels[index]}
              </text>
            ) : null,
          )}

          {/* barras */}
          {series.map((item, seriesIndex) => {
            const color = chartColorVar(pickColor(item.color, seriesIndex));
            return lookups[seriesIndex].map((text, xIndex) => {
              if (text === null) return null;
              const isForecast = item.points[xIndex]?.forecast ?? false;
              const value = parseDecimal(text);
              const y = round2(yScale(value));
              const barTop = value >= 0 ? y : zeroY;
              const barHeight = Math.max(1, Math.abs(zeroY - y));
              const isActive = active?.seriesIndex === seriesIndex && active?.xIndex === xIndex;
              return (
                <rect
                  key={`${item.key}:${xs[xIndex]}`}
                  x={barX(xIndex, seriesIndex)}
                  y={barTop}
                  width={round2(barWidth)}
                  height={barHeight}
                  rx={2}
                  style={{ fill: color, stroke: isForecast ? color : "none", strokeDasharray: isForecast ? "3 2" : undefined }}
                  fillOpacity={isForecast ? (isActive ? 0.55 : 0.35) : isActive ? 1 : 0.85}
                  strokeWidth={isForecast ? 1.5 : 0}
                  className="cursor-pointer transition-opacity"
                  onMouseEnter={() => setActive({ seriesIndex, xIndex })}
                  onMouseLeave={() => setActive(null)}
                />
              );
            });
          })}
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
            lookups[seriesIndex].map((text, xIndex) => {
              if (text === null) return null;
              const value = parseDecimal(text);
              const y = round2(yScale(value));
              const barTop = value >= 0 ? y : zeroY;
              const barHeight = Math.max(1, Math.abs(zeroY - y));
              const isStop = stop?.seriesIndex === seriesIndex && stop?.xIndex === xIndex;
              return (
                <rect
                  key={`${item.key}:${xs[xIndex]}`}
                  x={barX(xIndex, seriesIndex)}
                  y={barTop}
                  width={round2(barWidth)}
                  height={barHeight}
                  ref={(element) => {
                    if (element) pointRefs.current.set(`${seriesIndex}:${xIndex}`, element);
                    else pointRefs.current.delete(`${seriesIndex}:${xIndex}`);
                  }}
                  tabIndex={isStop ? 0 : -1}
                  role="img"
                  aria-label={`${pointLabel(seriesIndex, xIndex)}: ${pointValue(seriesIndex, xIndex)}`}
                  data-point={`${item.key}:${xs[xIndex]}`}
                  data-si={seriesIndex}
                  data-xi={xIndex}
                  fill="transparent"
                  className="pointer-events-auto cursor-pointer outline-none"
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
        </svg>

        {active !== null && activePt ? (
          <ChartTooltip
            leftPercent={round2((activePt.x / width) * 100)}
            topPercent={round2((activePt.y / height) * 100)}
            placement={tooltipPlacement(activePt.x, activePt.y, width)}
          >
            <div className="text-muted-foreground">{xLabels[active.xIndex]}</div>
            <div className="font-medium tabular-nums">
              {series.length > 1 && (
                <span className="mr-1 text-muted-foreground">{series[active.seriesIndex].label}</span>
              )}
              {formatValue(lookups[active.seriesIndex][active.xIndex] ?? "0")}
            </div>
          </ChartTooltip>
        ) : null}
      </div>

      {/* legenda (so com mais de uma serie) */}
      {series.length > 1 && (
        <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {series.map((item, seriesIndex) => {
            const color = chartColorVar(pickColor(item.color, seriesIndex));
            return (
              <li key={item.key} className="flex items-center gap-1.5">
                <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
                  <rect x={0} y={0} width={12} height={12} rx={2} style={{ fill: color }} />
                </svg>
                {item.label}
              </li>
            );
          })}
        </ul>
      )}

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
