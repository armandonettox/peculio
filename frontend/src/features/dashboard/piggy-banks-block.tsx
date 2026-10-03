import { Link } from "react-router-dom";

import { usePiggyBanks } from "@/api/piggy-banks";
import { formatMoney } from "@/lib/money";
import { DashboardBlock } from "./dashboard-block";

/** Quanto ja esta guardado em cada cofrinho. */
export function PiggyBanksBlock() {
  const query = usePiggyBanks();
  const items = query.data ?? [];

  return (
    <DashboardBlock
      title="Cofrinhos"
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={items.length === 0}
      empty={<p className="text-sm text-muted-foreground">Nenhum cofrinho ainda.</p>}
    >
      <ul className="flex flex-col gap-3">
        {items.map((piggy) => (
          <li key={piggy.id} className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-medium">{piggy.name}</p>
            <p className="shrink-0 text-sm tabular-nums">
              {formatMoney(piggy.saved, piggy.currency_code)}
              <span className="text-muted-foreground"> de {formatMoney(piggy.target_amount, piggy.currency_code)}</span>
            </p>
          </li>
        ))}
      </ul>
      <Link to="/cofrinhos" className="mt-4 inline-block text-sm font-medium text-primary-text hover:underline">
        Ver cofrinhos
      </Link>
    </DashboardBlock>
  );
}
