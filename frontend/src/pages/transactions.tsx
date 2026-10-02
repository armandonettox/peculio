import { ArrowLeftRight, Plus, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useAccounts } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { useCategories, useTags } from "@/api/labels";
import { useDeleteTransaction, useTransactions, type Transaction } from "@/api/transactions";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AttachmentsDialog } from "@/features/attachments/attachments-dialog";
import { FilterBar } from "@/features/transactions/filter-bar";
import { countActiveFilters, dateRangeError, readFilters, writeFilters } from "@/features/transactions/filters";
import { groupByDay, transactionTitle } from "@/features/transactions/presentation";
import { TransactionFormDialog } from "@/features/transactions/transaction-form-dialog";
import { TransactionRow } from "@/features/transactions/transaction-row";
import { useDraftFilter } from "@/features/transactions/use-draft-filter";
import { parseMoneyInput } from "@/lib/money";

// Os filtros de valor valem para qualquer moeda; a API aceita ate 2 casas
const FILTER_PLACES = 2;

const trimmed = (draft: string): string | null => draft.trim();
const asIs = (committed: string) => committed;

// Valor digitado ("1.234,50") -> valor do filtro ("1234.50"). null se for invalido.
function amountToCommitted(draft: string): string | null {
  if (draft.trim() === "") return "";
  const parsed = parseMoneyInput(draft, FILTER_PLACES);
  return parsed.ok ? parsed.value : null;
}

const amountToDraft = (committed: string) => committed.replace(".", ",");

function amountError(draft: string): string | undefined {
  if (draft.trim() === "") return undefined;
  const parsed = parseMoneyInput(draft, FILTER_PLACES);
  return parsed.ok ? undefined : parsed.error;
}

export default function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // "new": dialogo de criar; um lancamento: dialogo de editar
  const [dialog, setDialog] = useState<"new" | Transaction | null>(null);
  const [removing, setRemoving] = useState<Transaction | null>(null);
  const [attaching, setAttaching] = useState<Transaction | null>(null);
  const remove = useDeleteTransaction();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const activeCount = countActiveFilters(filters);

  const update = useCallback(
    (patch: Parameters<typeof writeFilters>[1]) =>
      setSearchParams((previous) => writeFilters(previous, patch), { replace: true }),
    [setSearchParams],
  );

  const [searchDraft, setSearchDraft] = useDraftFilter({
    committed: filters.q ?? "",
    toCommitted: trimmed,
    toDraft: asIs,
    onCommit: (draft) => update({ q: draft.trim() }),
  });
  const [minDraft, setMinDraft] = useDraftFilter({
    committed: filters.minAmount ?? "",
    toCommitted: amountToCommitted,
    toDraft: amountToDraft,
    onCommit: (draft) => update({ minAmount: amountToCommitted(draft) ?? "" }),
  });
  const [maxDraft, setMaxDraft] = useDraftFilter({
    committed: filters.maxAmount ?? "",
    toCommitted: amountToCommitted,
    toDraft: amountToDraft,
    onCommit: (draft) => update({ maxAmount: amountToCommitted(draft) ?? "" }),
  });

  const rangeError = dateRangeError(filters);
  const accounts = useAccounts({ includeArchived: true });
  const categories = useCategories({ search: "" });
  const tags = useTags({ search: "" });
  const query = useTransactions(filters, { enabled: !rangeError });

  const categoryList = categories.data?.items ?? [];
  const tagList = tags.data?.items ?? [];
  const lookups = useMemo(
    () => ({
      categories: new Map(categoryList.map((category) => [category.id, category])),
      tags: new Map(tagList.map((tag) => [tag.id, tag])),
    }),
    [categoryList, tagList],
  );

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;
  const groups = useMemo(() => groupByDay(items), [items]);

  function clearFilters() {
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  let content;
  if (rangeError) {
    content = null;
  } else if (query.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-2">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-20 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          Carregando lançamentos...
        </p>
      </div>
    );
  } else if (query.isError && items.length === 0) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(query.error)}
        </Alert>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    content =
      activeCount > 0 ? (
        <EmptyState
          icon={Search}
          title="Nada encontrado"
          description="Nenhum lançamento atende aos filtros escolhidos."
          action={
            <Button variant="outline" onClick={clearFilters}>
              Limpar filtros
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={ArrowLeftRight}
          title="Nenhum lançamento ainda"
          description="Os lançamentos que você registrar aparecem aqui, agrupados por dia."
          action={
            <Button onClick={() => setDialog("new")}>
              <Plus />
              Novo lançamento
            </Button>
          }
        />
      );
  } else {
    content = (
      <>
        <p className="mb-4 text-sm text-muted-foreground">
          {total} {total === 1 ? "lançamento" : "lançamentos"}
          {activeCount > 0 ? " com os filtros escolhidos" : ""}
        </p>
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.date} aria-label={group.label}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{group.label}</h2>
              <ul className="flex flex-col gap-2">
                {group.items.map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                    categories={lookups.categories}
                    tags={lookups.tags}
                    onEdit={setDialog}
                    onRemove={setRemoving}
                    onAttachments={setAttaching}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>

        {query.isError && (
          <Alert variant="destructive" className="mt-4">
            {getErrorMessage(query.error)}
          </Alert>
        )}
        {(query.hasNextPage || query.isError) && (
          <div className="mt-6 flex justify-center">
            <Button
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? "Carregando..." : "Carregar mais"}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Transações"
        description="Tudo o que entrou, saiu ou mudou de conta"
        actions={
          <Button onClick={() => setDialog("new")}>
            <Plus />
            Novo lançamento
          </Button>
        }
      />

      <FilterBar
        filters={filters}
        activeCount={activeCount}
        searchDraft={searchDraft}
        minDraft={minDraft}
        maxDraft={maxDraft}
        onSearchChange={setSearchDraft}
        onMinChange={setMinDraft}
        onMaxChange={setMaxDraft}
        minError={amountError(minDraft)}
        maxError={amountError(maxDraft)}
        dateError={rangeError}
        accounts={accounts.data ?? []}
        categories={categoryList}
        tags={tagList}
        onChange={update}
        onClear={clearFilters}
      />

      {content}

      {removing && (
        <ConfirmDeleteDialog
          title="Excluir lançamento"
          itemName={transactionTitle(removing)}
          consequence="O saldo das contas envolvidas volta ao que era antes dele."
          onConfirm={() => remove.mutateAsync(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}

      {attaching && <AttachmentsDialog transaction={attaching} onClose={() => setAttaching(null)} />}

      {dialog && (
        <TransactionFormDialog
          transaction={dialog === "new" ? undefined : dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
