import type { ReactNode } from "react";

import type { TooltipPlacement } from "./line-geometry";

export const EMPTY_TEXT = "Sem dados no período";

// Balao com o rotulo e o valor. Fica ao lado do desenho, posicionado em porcentagem do grafico
export function ChartTooltip({
  leftPercent,
  topPercent,
  placement,
  children,
}: {
  leftPercent: number;
  topPercent: number;
  placement: TooltipPlacement;
  children: ReactNode;
}) {
  const horizontal =
    placement.horizontal === "start" ? "-8px" : placement.horizontal === "end" ? "calc(-100% + 8px)" : "-50%";
  const vertical = placement.vertical === "above" ? "calc(-100% - 12px)" : "12px";
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 w-max max-w-56 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
      style={{ left: `${leftPercent}%`, top: `${topPercent}%`, transform: `translate(${horizontal}, ${vertical})` }}
    >
      {children}
    </div>
  );
}

// Tabela equivalente, so para leitor de tela: tem os mesmos numeros do desenho, ja formatados
export function ChartTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: { header: string; cells: string[] }[];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((header, index) => (
            <th key={index} scope="col">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            <th scope="row">{row.header}</th>
            {row.cells.map((cell, index) => (
              <td key={index}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Mensagem de grafico sem dados. Mantem role img para o grafico continuar sendo anunciado
export function EmptyChart({ label, kind, className }: { label: string; kind: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`${label}: ${EMPTY_TEXT.toLowerCase()}`}
      data-chart={kind}
      className={`flex min-h-24 items-center justify-center rounded-md border border-dashed p-4 text-sm text-muted-foreground ${className ?? ""}`}
    >
      {EMPTY_TEXT}
    </div>
  );
}
