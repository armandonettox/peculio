import { Link, useNavigate } from "react-router-dom";

import { useCategories, useTags } from "@/api/labels";
import { useTransactions } from "@/api/transactions";
import { TransactionRow } from "@/features/transactions/transaction-row";
import { DashboardBlock } from "./dashboard-block";

const RECENT_COUNT = 8;

/** Os lancamentos mais recentes, sem filtro. Editar, excluir e anexos levam para a tela de lancamentos. */
export function TransactionsBlock() {
  const navigate = useNavigate();
  const query = useTransactions({});
  const categories = useCategories({ search: "" });
  const tags = useTags({ search: "" });
  const goToTransactions = () => navigate("/transacoes");

  const items = (query.data?.pages[0]?.items ?? []).slice(0, RECENT_COUNT);
  const categoryMap = new Map((categories.data?.items ?? []).map((category) => [category.id, category]));
  const tagMap = new Map((tags.data?.items ?? []).map((tag) => [tag.id, tag]));

  return (
    <DashboardBlock
      title="Últimas transações"
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={items.length === 0}
      empty={<p className="text-sm text-muted-foreground">Nenhum lançamento ainda.</p>}
    >
      <ul className="flex flex-col gap-3">
        {items.map((transaction) => (
          <TransactionRow
            key={transaction.id}
            transaction={transaction}
            categories={categoryMap}
            tags={tagMap}
            onEdit={goToTransactions}
            onRemove={goToTransactions}
            onAttachments={goToTransactions}
          />
        ))}
      </ul>
      <Link to="/transacoes" className="mt-4 inline-block text-sm font-medium text-primary-text hover:underline">
        Ver todas
      </Link>
    </DashboardBlock>
  );
}
