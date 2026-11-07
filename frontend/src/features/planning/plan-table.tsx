import { CircleAlert, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { MonthlyPlan, PlanRow } from "@/api/plans";
import { TableScroll } from "@/components/table-scroll";
import { CategoryIcon } from "@/features/labels/category-icon";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PercentDots, PlanBar, PlanLegend } from "./plan-parts";
import { isOver } from "./presentation";

type Props = {
  plan: MonthlyPlan;
  monthLabel: string;
  onEdit: (row: PlanRow) => void;
  onDelete: (row: PlanRow) => void;
};

const iconButton =
  "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Selo de texto de uma linha com alerta ligado: nunca so a cor, quem nao enxerga cor tambem precisa saber. */
function StateBadge({ row }: { row: PlanRow }) {
  const { t } = useTranslation();
  if (!row.alert || row.state === "ok") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
        row.state === "exceeded" ? "border-destructive text-destructive" : "border-amber-600 text-amber-700 dark:text-amber-400",
      )}
    >
      <CircleAlert className="size-3" aria-hidden="true" />
      {row.state === "exceeded" ? t("planning.state.exceeded") : t("planning.state.near")}
    </span>
  );
}

/** A tabela do planejamento: uma linha por categoria com limite e a linha das categorias restantes. */
export function PlanTable({ plan, monthLabel, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  const money = (value: string) => formatMoney(value, plan.currency_code);

  return (
    <div className="flex flex-col gap-3">
      <TableScroll label={t("planning.table.label", { month: monthLabel })} className="border-0">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">
                {t("planning.table.category")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("planning.table.planned")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("planning.table.paid")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("planning.table.expected")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("planning.table.total")}
              </th>
              <th scope="col" className="w-56 px-3 py-2 font-medium">
                {t("planning.table.progress")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("planning.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((row) => {
              const name = row.kind === "rest" ? t("planning.table.rest") : (row.category_name ?? "");
              const over = isOver(row.remaining);
              return (
                <tr key={row.category_id ?? "rest"} className="border-b last:border-0">
                  <th scope="row" className="px-3 py-3 text-left font-medium">
                    <span className="flex items-center gap-2">
                      {row.kind === "category" && <CategoryIcon name={row.category_icon} color={row.category_color} />}
                      <span className="flex min-w-0 flex-col items-start gap-1">
                        <span className="break-words">{name}</span>
                        <StateBadge row={row} />
                      </span>
                    </span>
                  </th>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{money(row.planned)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{money(row.paid)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{money(row.expected)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{money(row.total)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1.5">
                      <p className={cn("text-xs", over && "font-medium text-destructive")}>
                        {over
                          ? t("planning.row.over", { value: money(row.remaining.replace("-", "")) })
                          : t("planning.row.remaining", { value: money(row.remaining) })}
                      </p>
                      <PlanBar amounts={row} label={t("planning.row.barLabel", { name, paid: money(row.paid), expected: money(row.expected), planned: money(row.planned) })} />
                      <PercentDots amounts={row} />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {row.kind === "category" && row.category_id && (
                      <div className="flex justify-end gap-1">
                        <button type="button" className={iconButton} aria-label={t("planning.row.edit", { name })} onClick={() => onEdit(row)}>
                          <Pencil className="size-4" aria-hidden="true" />
                        </button>
                        <button type="button" className={iconButton} aria-label={t("planning.row.delete", { name })} onClick={() => onDelete(row)}>
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      <PlanLegend />
    </div>
  );
}
