import { AlertTriangle, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

import { useUpcoming } from "@/api/dashboard";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DashboardBlock } from "./dashboard-block";
import { directionText, upcomingAmountText } from "./presentation";
import { useTranslation } from "react-i18next";

/** Contas a pagar e recorrentes dos proximos 30 dias, com as atrasadas em destaque. */
export function UpcomingBlock() {
  const { t } = useTranslation();
  const query = useUpcoming({ days: 30 });
  const items = query.data?.items ?? [];

  return (
    <DashboardBlock
      title={t("dashboard.upcomingBlock.proximosVencimentos")}
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={items.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.upcomingBlock.nadaVencendoNosProximos")}</p>}
    >
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`} className="flex items-start gap-2">
            {item.direction === "in" ? (
              <ArrowDownRight className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden="true" />
            ) : (
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-medium">{item.name}</p>
                {item.overdue && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                    <AlertTriangle className="size-3" aria-hidden="true" />
                    {t("dashboard.upcomingBlock.atrasada")}
                  </span>
                )}
              </div>
              <p className={cn("text-xs text-muted-foreground", item.overdue && "text-destructive")}>
                {formatDate(item.date)} · {directionText(item.direction)} · {upcomingAmountText(item)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <Link to="/contas-a-pagar" className="mt-4 inline-block text-sm font-medium text-primary-text hover:underline">
        {t("dashboard.upcomingBlock.verContasAPagar")}
      </Link>
    </DashboardBlock>
  );
}
