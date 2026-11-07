import { ChevronDown, ChevronLeft, ChevronRight, Filter, LayoutList, Search, Table2, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAccounts } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { useCategories, useTags } from "@/api/labels";
import { useDeleteTransaction, useTransactions, type Transaction } from "@/api/transactions";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AttachmentsDialog } from "@/features/attachments/attachments-dialog";
import { FilterDrawer } from "@/features/transactions/filter-drawer";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { SavedFilter } from "@/features/transactions/saved-filters";
import { countActiveFilters, dateRangeError, readFilters, readKind, writeFilters, writeKind, type KindFilter } from "@/features/transactions/filters";

import { groupByDay, transactionTitle } from "@/features/transactions/presentation";
import { TransactionFormDialog } from "@/features/transactions/transaction-form-dialog";
import { TransactionRow } from "@/features/transactions/transaction-row";
import { TransactionsTable } from "@/features/transactions/transactions-table";
import { TransactionsSummaryCards } from "@/features/transactions/transactions-summary-cards";
import { useDraftFilter } from "@/features/transactions/use-draft-filter";
import { readViewMode, saveViewMode, type ViewMode } from "@/features/transactions/view-mode";
import { appToday, firstOfMonth, formatMonthYear, shiftDay, shiftMonth } from "@/lib/dates";
import { parseMoneyInput } from "@/lib/money";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const FILTER_PLACES = 2;

const trimmed = (draft: string): string | null => draft.trim();
const asIs = (committed: string) => committed;

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

function lastOfMonth(date: string): string {
  return shiftDay(shiftMonth(date, 1), -1);
}

function splitMonthYear(date: string): { month: string; year: string } {
  const full = formatMonthYear(date);
  const match = full.match(/^(.+?)\s+(?:de\s+)?(\d{4})$/);
  if (match) return { month: match[1], year: match[2] };
  return { month: full, year: "" };
}

type KindLabelKey = "pages.transactions.todas" | "pages.transactions.despesas" | "pages.transactions.receitas" | "pages.transactions.transferencias" | "pages.transactions.despesasCartao";

const KIND_OPTIONS: { value: KindFilter | null; labelKey: KindLabelKey }[] = [
  { value: null, labelKey: "pages.transactions.todas" },
  { value: "withdrawal", labelKey: "pages.transactions.despesas" },
  { value: "deposit", labelKey: "pages.transactions.receitas" },
  { value: "transfer", labelKey: "pages.transactions.transferencias" },
  { value: "credit_card_expense", labelKey: "pages.transactions.despesasCartao" },
];

export default function TransactionsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialog, setDialog] = useState<"new" | Transaction | null>(null);
  const [removing, setRemoving] = useState<Transaction | null>(null);
  const [attaching, setAttaching] = useState<Transaction | null>(null);
  const remove = useDeleteTransaction();
  const [view, setView] = useState<ViewMode>(readViewMode);
  const [filterOpen, setFilterOpen] = useState(() => {
    const { q: _q, ...pf } = readFilters(searchParams);
    return countActiveFilters(pf) > 0;
  });

  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const kind = useMemo(() => readKind(searchParams), [searchParams]);
  const activeCount = countActiveFilters(filters);
  // Badge no botao de filtros: exclui a busca (q), que tem controle proprio
  const { q: _q, ...panelFilters } = filters;
  const badgeCount = countActiveFilters(panelFilters);

  // Mes navegado: usa dateFrom da URL ou o mes atual
  const today = appToday();
  const monthAnchor = filters.dateFrom ?? firstOfMonth(today);
  const monthStart = firstOfMonth(monthAnchor);
  const monthEnd = lastOfMonth(monthStart);

  const effectiveFilters = filters;

  const update = useCallback(
    (patch: Parameters<typeof writeFilters>[1]) =>
      setSearchParams((previous) => writeFilters(previous, patch), { replace: true }),
    [setSearchParams],
  );

  function navigateMonth(delta: number) {
    const newStart = shiftMonth(monthStart, delta);
    const newEnd = lastOfMonth(newStart);
    setSearchParams(
      (previous) => writeFilters(previous, { dateFrom: newStart, dateTo: newEnd }),
      { replace: true },
    );
  }

  function setKind(value: KindFilter | null) {
    setSearchParams((previous) => writeKind(previous, value), { replace: true });
  }

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

  const rangeError = dateRangeError(effectiveFilters);
  const accounts = useAccounts({ includeArchived: true });
  const categories = useCategories({ search: "" });
  const tags = useTags({ search: "" });
  const query = useTransactions(effectiveFilters, { enabled: !rangeError });

  const categoryList = categories.data?.items ?? [];
  const tagList = tags.data?.items ?? [];
  const lookups = useMemo(
    () => ({
      categories: new Map(categoryList.map((category) => [category.id, category])),
      tags: new Map(tagList.map((tag) => [tag.id, tag])),
    }),
    [categoryList, tagList],
  );

  const allItems = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const creditCardIds = useMemo(
    () => new Set((accounts.data ?? []).filter((a) => a.role === "credit_card").map((a) => a.id)),
    [accounts.data],
  );
  const items = useMemo(() => {
    if (!kind) return allItems;
    if (kind === "credit_card_expense") {
      return allItems.filter((item) =>
        item.splits.some((s) => s.type === "withdrawal" && creditCardIds.has(s.source_account_id)),
      );
    }
    return allItems.filter((item) => item.splits.some((s) => s.type === kind));
  }, [allItems, kind, creditCardIds]);
  const total = query.data?.pages[0]?.total ?? 0;
  const groups = useMemo(() => groupByDay(items), [items]);

  function chooseView(mode: ViewMode) {
    setView(mode);
    saveViewMode(mode);
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  function applySavedFilter(entry: SavedFilter) {
    setSearchParams((previous) => {
      let next = writeFilters(previous, entry.filters);
      next = writeKind(next, entry.kind);
      return next;
    }, { replace: true });
  }

  const currentKindOption = KIND_OPTIONS.find((o) => o.value === kind) ?? KIND_OPTIONS[0];

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
      activeCount > 0 || kind ? (
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
          icon={Search}
          title={t("pages.transactions.nenhumLancamentoAinda")}
          description={t("pages.transactions.osLancamentosQueVoce")}
        />
      );
  } else {
    content = (
      <>
        <div className="mb-4">
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? t("pages.transactions.lancamento") : t("pages.transactions.lancamentos")}
            {activeCount > 0 ? ` ${t("pages.transactions.comOsFiltrosEscolhidos")}` : ""}
          </p>
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
      <PageHeader title={t("pages.transactions.transacoes")} />

      {/* Barra de acoes */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Filtro rapido por tipo */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="default" className="gap-1 shrink-0 rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/90">
              <ChevronDown className="size-3" />
              {t(currentKindOption.labelKey)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {KIND_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value ?? "all"}
                onClick={() => setKind(option.value)}
                className={option.value === kind ? "font-semibold" : ""}
              >
                {t(option.labelKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Campo de busca: sempre visivel. No celular ocupa a linha de baixo inteira (ao lado dos botoes ficava minusculo) */}
        <div className="relative order-3 w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label={t("transactions.filterBar.buscarLancamentos")}
            placeholder={t("transactions.filterBar.buscarLancamentos")}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="h-9 pl-9"
          />
        </div>

        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          {searchDraft && (
            <Button
              size="icon"
              variant="ghost"
              className="size-9 shrink-0"
              aria-label={t("common.fechar")}
              onClick={() => { setSearchDraft(""); update({ q: "" }); }}
            >
              <X className="size-4" />
            </Button>
          )}

          {/* Funil: abre drawer lateral */}
          <Button
            size="icon"
            variant="outline"
            className={`relative size-9 rounded-full ${badgeCount > 0 ? "border-primary text-primary-text" : ""}`}
            aria-label={badgeCount > 0 ? `${t("transactions.filterBar.filters")} (${badgeCount})` : t("transactions.filterBar.filters")}
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(true)}
          >
            <Filter className="size-4" />
            {badgeCount > 0 && (
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                {badgeCount}
              </span>
            )}
          </Button>

          {/* Alternar entre lista e tabela */}
          <Button
            size="icon"
            variant="outline"
            className="size-9 rounded-full"
            aria-label={t("pages.transactions.lista")}
            aria-pressed={view === "list"}
            onClick={() => chooseView("list")}
          >
            <LayoutList className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-9 rounded-full"
            aria-label={t("pages.transactions.tabela")}
            aria-pressed={view === "table"}
            onClick={() => chooseView("table")}
          >
            <Table2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Drawer lateral de filtros avancados */}
      <Sheet open={filterOpen} onOpenChange={setFilterOpen} modal={false}>
        <SheetContent className="left-auto right-0 flex h-full w-[420px] flex-col border-l border-r-0 p-0">
          <FilterDrawer
            filters={effectiveFilters}
            kind={kind}
            minDraft={minDraft}
            maxDraft={maxDraft}
            onMinChange={setMinDraft}
            onMaxChange={setMaxDraft}
            minError={amountError(minDraft)}
            maxError={amountError(maxDraft)}
            dateError={rangeError}
            accounts={accounts.data ?? []}
            categories={categoryList}
            tags={tagList}
            onChange={update}
            onKindChange={setKind}
            onClear={clearFilters}
            onApplySaved={applySavedFilter}
            onClose={() => setFilterOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Cards de resumo do mes */}
      <TransactionsSummaryCards dateFrom={monthStart} dateTo={monthEnd} />

      {/* Navegador de mes */}
      {(() => {
        const { month, year } = splitMonthYear(monthStart);
        return (
          <div className="mb-4 flex items-center justify-center gap-3">
            <Button size="icon" variant="ghost" className="size-8 text-primary-text hover:text-primary-text" onClick={() => navigateMonth(-1)} aria-label={t("pages.budgets.mesAnterior")}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="inline-flex items-center gap-1 rounded-full border border-primary px-5 py-1 text-sm font-medium">
              {month}{year && <> <span className="text-primary-text">{year}</span></>}
            </span>
            <Button size="icon" variant="ghost" className="size-8 text-primary-text hover:text-primary-text" onClick={() => navigateMonth(1)} aria-label={t("pages.budgets.proximoMes")}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        );
      })()}
      {/* Sem mes escolhido, os cards mostram o mes atual mas a lista traz todos os meses: avisa para nao confundir */}
      {filters.dateFrom === undefined && (
        <p className="-mt-2 mb-4 text-center text-xs text-muted-foreground">{t("pages.transactions.listaDeTodosOsMeses")}</p>
      )}

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
