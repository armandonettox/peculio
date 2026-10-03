import { Link } from "react-router-dom";

import { useCategories } from "@/api/labels";
import { useTransactions } from "@/api/transactions";
import { appToday } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DashboardBlock } from "./dashboard-block";
import { recentLine } from "./presentation";

const RECENT_COUNT = 8;

/**
 * Os lancamentos mais recentes, sem filtro, em linhas compactas (uma por lancamento). Para editar, excluir
 * ou ver anexos, o link leva a tela de transacoes, que e onde essas acoes vivem.
 */
export function TransactionsBlock() {
  const query = useTransactions({});
  const categories = useCategories({ search: "" });

  const categoryMap = new Map((categories.data?.items ?? []).map((category) => [category.id, category]));
  const today = appToday();
  const lines = (query.data?.pages[0]?.items ?? []).slice(0, RECENT_COUNT).map((item) => recentLine(item, categoryMap, today));

  return (
    <DashboardBlock
      title="Últimas transações"
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={lines.length === 0}
      empty={<p className="text-sm text-muted-foreground">Nenhum lançamento ainda.</p>}
    >
      <ul className="flex flex-col divide-y">
        {lines.map((line) => (
          <li key={line.id} className="flex items-baseline gap-3 py-2 text-sm first:pt-0">
            <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">{line.date}</span>
            <p className="min-w-0 flex-1 truncate" title={line.detail ? `${line.title} · ${line.detail}` : line.title}>
              <span className="font-medium">{line.title}</span>
              {line.detail && <span className="text-muted-foreground"> · {line.detail}</span>}
            </p>
            {line.amount && (
              <span className={cn("shrink-0 tabular-nums font-medium", line.direction === "in" ? "text-positive" : "text-foreground")}>
                {line.amount}
              </span>
            )}
          </li>
        ))}
      </ul>
      <Link to="/transacoes" className="mt-4 inline-block text-sm font-medium text-primary-text hover:underline">
        Ver todas
      </Link>
    </DashboardBlock>
  );
}
