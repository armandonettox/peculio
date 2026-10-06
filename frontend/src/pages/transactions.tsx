import { ArrowLeftRight, LayoutList, Plus, Search, Table2 } from "lucide-react";
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
import { TransactionsTable } from "@/features/transactions/transactions-table";
import { useDraftFilter } from "@/features/transactions/use-draft-filter";
import { readViewMode, saveViewMode, type ViewMode } from "@/features/transactions/view-mode";
import { parseMoneyInput } from "@/lib/money";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  // "new": dialogo de criar; um lancamento: dialogo de editar
  const [dialog, setDialog] = useState<"new" | Transaction | null>(null);
  const [removing, setRemoving] = useState<Transaction | null>(null);
  const [attaching, setAttaching] = useState<Transaction | null>(null);
  const remove = useDeleteTransaction();
  const [view, setView] = useState<ViewMode>(readViewMode);
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

  function chooseView(mode: ViewMode) {
    setView(mode);
    saveViewMode(mode);
  }

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
          {t("pages.transactions.carregandoLancamentos")}
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
          {t("common.tentarDeNovo")}
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    content =
      activeCount > 0 ? (
        <EmptyState
          icon={Search}
          title={t("pages.transactions.nadaEncontrado")}
          description={t("pages.transactions.nenhumLancamentoAtendeAos")}
          action={
            <Button variant="outline" onClick={clearFilters}>
              {t("common.limparFiltros")}
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={ArrowLeftRight}
          title={t("pages.transactions.nenhumLancamentoAinda")}
          description={t("pages.transactions.osLancamentosQueVoce")}
          action={
            <Button onClick={() => setDialog("new")}>
              <Plus />
              {t("pages.transactions.novoLancamento")}
            </Button>
          }
        />
      );
  } else {
    content = (
      <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? t("pages.transactions.lancamento") : t("pages.transactions.lancamentos")}
            {activeCount > 0 ? ` ${t("pages.transactions.comOsFiltrosEscolhidos")}` : ""}
          </p>
          <div role="group" aria-label={t("pages.transactions.comoMostrarOsLancamentos")} className="flex gap-1">
            <Button size="sm" variant={view === "list" ? "default" : "outline"} aria-pressed={view === "list"} onClick={() => chooseView("list")}>
              <LayoutList />
              {t("pages.transactions.lista")}
            </Button>
            <Button size="sm" variant={view === "table" ? "default" : "outline"} aria-pressed={view === "table"} onClick={() => chooseView("table")}>
              <Table2 />
              {t("pages.transactions.tabela")}
            </Button>
          </div>
        </div>
        {view === "table" ? (
          <TransactionsTable
            items={items}
            total={total}
            categories={lookups.categories}
            accounts={accounts.data ?? []}
            onOpen={setDialog}
            onRemove={setRemoving}
          />
        ) : (
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
        )}

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
              {query.isFetchingNextPage ? t("common.carregando") : t("pages.transactions.carregarMais")}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("pages.transactions.transacoes")}
        description={t("pages.transactions.tudoOQueEntrou")}
        actions={
          <Button onClick={() => setDialog("new")}>
            <Plus />
            {t("pages.transactions.novoLancamento")}
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
          title={t("pages.transactions.excluirLancamento")}
          itemName={transactionTitle(removing)}
          consequence={t("pages.transactions.oSaldoDasContas")}
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
