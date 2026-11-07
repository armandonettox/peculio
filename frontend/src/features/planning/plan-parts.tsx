import { useTranslation } from "react-i18next";

import type { PlanRow } from "@/api/plans";
import { cn } from "@/lib/utils";
import { barSegments, formatPercent, percentOfLimit } from "./presentation";

type Amounts = Pick<PlanRow, "planned" | "paid" | "expected">;

// Os quatro tons da barra e da legenda: pago e previsto dentro do limite, pago e previsto que passaram dele
const TONES = {
  paid: "bg-positive",
  expected: "bg-positive/40",
  paidOver: "bg-destructive",
  expectedOver: "bg-destructive/40",
} as const;

/** Barra empilhada de uma linha. E so o desenho: os valores em texto vem ao lado, nunca so pela cor. */
export function PlanBar({ amounts, label, className }: { amounts: Amounts; label: string; className?: string }) {
  const segments = barSegments(amounts);
  const parts: [keyof typeof TONES, number][] = [
    ["paid", segments.paidWithin],
    ["expected", segments.expectedWithin],
    ["paidOver", segments.paidOver],
    ["expectedOver", segments.expectedOver],
  ];
  return (
    <div role="img" aria-label={label} className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      {parts.map(([tone, width]) =>
        width > 0 ? <span key={tone} className={TONES[tone]} style={{ width: `${width}%` }} /> : null,
      )}
    </div>
  );
}

/** Os dois percentuais de uma linha, pago e previsto, cada um com a sua bolinha. */
export function PercentDots({ amounts }: { amounts: Amounts }) {
  const { t } = useTranslation();
  const paid = percentOfLimit(amounts.paid, amounts.planned);
  const expected = percentOfLimit(amounts.expected, amounts.planned);
  return (
    <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className={cn("size-2 rounded-full", TONES.paid)} />
        <span className="sr-only">{t("planning.legend.paid")}: </span>
        {formatPercent(paid)}
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className={cn("size-2 rounded-full", TONES.expected)} />
        <span className="sr-only">{t("planning.legend.expected")}: </span>
        {formatPercent(expected)}
      </span>
    </p>
  );
}

/** Legenda das cores da barra, no fim da tabela. */
export function PlanLegend() {
  const { t } = useTranslation();
  const items: [keyof typeof TONES, string][] = [
    ["paid", t("planning.legend.paid")],
    ["expected", t("planning.legend.expected")],
    ["paidOver", t("planning.legend.paidOver")],
    ["expectedOver", t("planning.legend.expectedOver")],
  ];
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([tone, text]) => (
        <li key={tone} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("size-2.5 rounded-full", TONES[tone])} />
          {text}
        </li>
      ))}
    </ul>
  );
}
