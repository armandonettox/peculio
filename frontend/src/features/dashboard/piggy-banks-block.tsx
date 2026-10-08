import { Link } from "react-router-dom";

import { usePiggyBanks } from "@/api/piggy-banks";
import { isReached, remainingText } from "@/features/piggy-banks/presentation";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { DashboardBlock } from "./dashboard-block";
import { useTranslation } from "react-i18next";

/** Quanto ja esta guardado em cada cofrinho, com a mesma barra de progresso da pagina de cofrinhos. */
export function PiggyBanksBlock() {
  const { t } = useTranslation();
  const query = usePiggyBanks();
  const items = query.data ?? [];

  return (
    <DashboardBlock
      title={t("dashboard.piggyBanksBlock.cofrinhos")}
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={items.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.piggyBanksBlock.nenhumCofrinhoAinda")}</p>}
    >
      <ul className="flex flex-col gap-4">
        {items.map((piggy) => {
          const reached = isReached(piggy);
          // A barra enche ate 100%; o que passou da meta aparece no percentual
          const filled = Math.min(piggy.percent, 100);
          return (
            <li key={piggy.id} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium">{piggy.name}</p>
                <p className="shrink-0 text-xs text-muted-foreground">{remainingText(piggy)}</p>
              </div>
              <div
                role="progressbar"
                aria-label={t("dashboard.piggyBanksBlock.savedOf", { name: piggy.name })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={filled}
                aria-valuetext={t("dashboard.piggyBanksBlock.percentOfTarget", { percent: piggy.percent })}
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
              >
                <div className={cn("h-full rounded-full", reached ? "bg-positive" : "bg-primary-text")} style={{ width: `${filled}%` }} />
              </div>
              <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                {formatMoney(piggy.saved, piggy.currency_code)}
                <span>
                  {" "}
                  {t("dashboard.piggyBanksBlock.ofTarget", { target: formatMoney(piggy.target_amount, piggy.currency_code) })}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
      <Link to="/cofrinhos" className="mt-4 inline-block text-sm font-medium text-primary-text hover:underline">
        {t("dashboard.piggyBanksBlock.verCofrinhos")}
      </Link>
    </DashboardBlock>
  );
}
