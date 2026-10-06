import { Keyboard, Lock, Maximize2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { useCurrencies, type Account } from "@/api/accounts";
import { useBulkTransactions, type BulkRequest } from "@/api/bulk";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import type { Category } from "@/api/labels";
import { useCreateTransaction, useUpdateTransaction, type Transaction } from "@/api/transactions";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { BulkCategoryDialog, BulkDateDialog } from "./bulk-dialogs";
import { bulkNotice, entriesText, lockedSummary } from "./bulk-presentation";
import { emptyForm, type FormContext, type FormState } from "./form-model";
import {
  counterpartyLabel,
  directionOf,
  formatTransactionAmount,
  ownAccountName,
  reconciliationState,
  transactionDate,
  transactionTitle,
} from "./presentation";
import { QuickRowEditor } from "./quick-row-editor";
import { emptyQuickRow, quickFromTransaction, rowAfterAdd, type QuickColumn, type QuickRow } from "./quick-row";
import {
  EMPTY_SELECTION,
  limitMessage,
  overLimit,
  prune,
  selectedInOrder,
  selectionSummary,
  selectRange,
  toggle,
  toggleAll,
  type Selection,
} from "./selection";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { navAction, nextIndex, tabStop } from "./table-nav";
import { useTranslation } from "react-i18next";

type Props = {
  items: Transaction[];
  // Quantos lancamentos ha no total (a lista pode ter mais do que o que esta carregado)
  total: number;
  categories: Map<string, Category>;
  accounts: Account[];
  // O formulario completo (dividir, outra moeda, tags, orcamento, anexos...)
  onOpen: (transaction: Transaction) => void;
  onRemove: (transaction: Transaction) => void;
};

type Creating = { id: number; initial: QuickRow; focus: QuickColumn };
type Editing = { id: string; row: QuickRow; base: FormState };
type BulkDialog = "category" | "date" | "delete" | null;
type BulkError = { message: string; lockedIds: string[] };

const iconButton =
  "flex size-8 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Os lancamentos em linhas de tabela, para quem lanca e confere muita coisa. Uma parada de Tab so: com o foco na linha,
 * as setas (ou J e K) andam entre as linhas, Home e End vao para as pontas, Enter edita a linha ali mesmo e T abre uma
 * linha de entrada no topo. Espaco marca a linha, Shift+Espaco marca um intervalo, Ctrl+A marca todas as carregadas e Esc
 * limpa; com algo marcado, uma barra oferece mudar categoria, mudar data, duplicar e excluir de uma vez. O que a linha
 * nao mostra (dividir, outra moeda, tags, orcamento...) fica no formulario completo.
 */
export function TransactionsTable({ items, total, categories, accounts, onOpen, onRemove }: Props) {
  const { t } = useTranslation();
  const currencies = useCurrencies();
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const bulk = useBulkTransactions();
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [bulkDialog, setBulkDialog] = useState<BulkDialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<BulkError | null>(null);
  // Linha que recebe o foco quando o editor fecha
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);
  const newButton = useRef<HTMLButtonElement>(null);
  const stop = tabStop(active, items.length);
  const order = useMemo(() => items.map((item) => item.id), [items]);
  const count = selection.ids.size;
  const tooMany = overLimit(count);

  const ctx: FormContext = useMemo(
    () => ({ accounts, places: Object.fromEntries((currencies.data ?? []).map((currency) => [currency.code, currency.decimal_places])) }),
    [accounts, currencies.data],
  );
  const categoryList = useMemo(() => [...categories.values()], [categories]);

  useEffect(() => {
    if (pendingFocus === null || editing || items.length === 0) return;
    rows.current[Math.min(pendingFocus, items.length - 1)]?.focus();
    setPendingFocus(null);
  }, [pendingFocus, editing, items.length]);

  // O que saiu da lista (excluido, filtrado fora) sai da selecao
  useEffect(() => {
    setSelection((current) => prune(current, order));
  }, [order]);

  function startNew() {
    setEditing(null);
    setCreating({ id: Date.now(), initial: emptyQuickRow(ctx), focus: "date" });
  }

  function startEdit(transaction: Transaction) {
    const loaded = quickFromTransaction(transaction, ctx);
    // Divisao, transferencia e divida nao cabem nas colunas: so o formulario completo edita sem perder nada
    if (!loaded.ok) return onOpen(transaction);
    setCreating(null);
    setEditing({ id: transaction.id, row: loaded.row, base: loaded.base });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>, index: number) {
    // So a tecla apertada na propria linha: dentro de um botao ou campo ela e dele
    if (event.target !== event.currentTarget) return;
    const action = navAction(event);
    if (!action) return;
    event.preventDefault();
    const id = items[index].id;
    if (action.kind === "new") return startNew();
    if (action.kind === "open") return startEdit(items[index]);
    if (action.kind === "select") return setSelection((current) => toggle(current, id));
    if (action.kind === "range") return setSelection((current) => selectRange(current, id, order));
    if (action.kind === "all") return setSelection((current) => toggleAll(current, order));
    if (action.kind === "clear") return setSelection(EMPTY_SELECTION);
    const target = nextIndex(index, items.length, action);
    if (target === null) return;
    setActive(target);
    rows.current[target]?.focus();
  }

  function handleCheck(event: ChangeEvent<HTMLInputElement>, id: string) {
    const withShift = (event.nativeEvent as MouseEvent).shiftKey === true;
    setSelection((current) => (withShift ? selectRange(current, id, order) : toggle(current, id)));
  }

  // Roda a acao em massa. Nunca lanca: o resultado vira aviso (ou erro) acima da tabela.
  async function runBulk(body: BulkRequest, categoryCleared = false): Promise<boolean> {
    setNotice(null);
    setBulkError(null);
    try {
      const result = await bulk.mutateAsync(body);
      setNotice(bulkNotice(body.action, result.affected, categoryCleared));
      setSelection(EMPTY_SELECTION);
      setPendingFocus(stop);
      return true;
    } catch (failure) {
      setBulkError({ message: getErrorMessage(failure), lockedIds: failure instanceof ApiError ? failure.lockedIds : [] });
      return false;
    }
  }

  const selectedIds = () => selectedInOrder(selection, order);
  const titleOf = (id: string) => {
    const found = items.find((item) => item.id === id);
    return found ? transactionTitle(found) : "outro lançamento";
  };

  function unselectLocked() {
    const locked = new Set(bulkError?.lockedIds ?? []);
    setSelection((current) => ({ ids: new Set([...current.ids].filter((id) => !locked.has(id))), anchor: current.anchor }));
    setBulkError(null);
  }

  const allSelected = items.length > 0 && items.every((item) => selection.ids.has(item.id));

  return (
    <div className="relative overflow-x-auto rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {t("transactions.transactionsTable.comOFocoNuma")}
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setShowShortcuts(true)}>
            <Keyboard />
            {t("transactions.transactionsTable.atalhos")}
          </Button>
          <Button ref={newButton} type="button" size="sm" variant="outline" onClick={startNew}>
            <Plus />
            {t("transactions.transactionsTable.novaLinha")}
          </Button>
        </div>
      </div>
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}

      {count > 0 && (
        <div role="region" aria-label={t("transactions.transactionsTable.acoesEmMassa")} className="flex flex-wrap items-center gap-2 border-b bg-accent/50 px-3 py-2">
          <p role="status" className="mr-auto text-sm font-medium">
            {selectionSummary(count, items.length, total)}
          </p>
          {limitMessage(count) && <p className="text-xs text-destructive">{limitMessage(count)}</p>}
          <Button type="button" size="sm" variant="outline" disabled={bulk.isPending || tooMany} onClick={() => setBulkDialog("category")}>
            {t("transactions.transactionsTable.mudarCategoria")}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={bulk.isPending || tooMany} onClick={() => setBulkDialog("date")}>
            {t("transactions.transactionsTable.mudarData")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={bulk.isPending || tooMany}
            onClick={() => void runBulk({ ids: selectedIds(), action: "duplicate" })}
          >
            {t("transactions.transactionsTable.duplicar")}
          </Button>
          <Button type="button" size="sm" variant="destructive" disabled={bulk.isPending || tooMany} onClick={() => setBulkDialog("delete")}>
            {t("common.excluir")}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={bulk.isPending} onClick={() => setSelection(EMPTY_SELECTION)}>
            {t("transactions.transactionsTable.limparSelecao")}
          </Button>
        </div>
      )}

      {notice && (
        <p role="status" className="border-b bg-accent/30 px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      {bulkError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="mr-auto">
            {bulkError.message}
            {bulkError.lockedIds.length > 0 && <> {t("transactions.table.locked", { list: lockedSummary(bulkError.lockedIds.map(titleOf)) })}</>}
          </p>
          {bulkError.lockedIds.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={unselectLocked}>
              {t("transactions.transactionsTable.desmarcarOsTravados")}
            </Button>
          )}
        </div>
      )}

      <table className="w-full min-w-[60rem] text-left text-sm">
        <caption className="sr-only">
          {t("transactions.transactionsTable.lancamentosEmTabelaUse")}
        </caption>
        <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-10 px-3 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(element) => {
                  if (element) element.indeterminate = count > 0 && !allSelected;
                }}
                onChange={() => setSelection((current) => toggleAll(current, order))}
                disabled={items.length === 0}
                aria-label={t("transactions.transactionsTable.selecionarTodosOsCarregados")}
                className="accent-[var(--primary)]"
              />
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("common.data")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("common.descricao")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("transactions.transactionsTable.contraparte")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("common.conta")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("common.categoria")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("common.valor")}
            </th>
            <th scope="col" className="w-28 px-3 py-2 font-medium">
              <span className="sr-only">{t("transactions.transactionsTable.acoes")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {creating && (
            <QuickRowEditor
              key={creating.id}
              mode="new"
              initial={creating.initial}
              base={emptyForm(ctx)}
              ctx={ctx}
              categories={categoryList}
              focusColumn={creating.focus}
              save={(payload) => create.mutateAsync(payload)}
              onDone={(saved, closeAfter) => {
                if (closeAfter) {
                  setCreating(null);
                  newButton.current?.focus();
                } else {
                  // A proxima linha segue na mesma data e conta, com o foco na descricao
                  setCreating({ id: Date.now(), initial: rowAfterAdd(saved, ctx), focus: "description" });
                }
              }}
              onCancel={() => {
                setCreating(null);
                newButton.current?.focus();
              }}
            />
          )}
          {items.map((transaction, index) => {
            if (editing?.id === transaction.id) {
              return (
                <QuickRowEditor
                  key={transaction.id}
                  mode="edit"
                  initial={editing.row}
                  base={editing.base}
                  ctx={ctx}
                  categories={categoryList}
                  save={(payload) => update.mutateAsync({ id: transaction.id, body: payload })}
                  onDone={() => {
                    setEditing(null);
                    // Como numa planilha: gravou, o foco desce para a linha de baixo
                    setPendingFocus(index + 1);
                  }}
                  onCancel={() => {
                    setEditing(null);
                    setPendingFocus(index);
                  }}
                />
              );
            }
            const [first] = transaction.splits;
            const split = transaction.splits.length > 1;
            const state = reconciliationState(transaction);
            const amount = formatTransactionAmount(transaction);
            const title = transactionTitle(transaction);
            const category = !split && first?.category_id ? categories.get(first.category_id) : undefined;
            const selected = selection.ids.has(transaction.id);
            return (
              <tr
                key={transaction.id}
                ref={(element) => {
                  rows.current[index] = element;
                }}
                tabIndex={index === stop ? 0 : -1}
                aria-label={`${title}, ${amount ?? ""}`.trim()}
                onFocus={() => setActive(index)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={cn(
                  "cursor-default focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected && "bg-accent/40",
                )}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => handleCheck(event, transaction.id)}
                    aria-label={t("transactions.table.select", { title })}
                    className="accent-[var(--primary)]"
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDate(transactionDate(transaction))}</td>
                <td className="px-3 py-2 sm:max-w-64">
                  <p className="break-words sm:truncate" title={title}>
                    {title}
                  </p>
                  {state && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {state === "locked" && <Lock className="size-3" aria-hidden="true" />}
                      {state === "locked" ? t("transactions.transactionsTable.conciliado") : t("transactions.transactionsTable.conferido")}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground sm:max-w-48">
                  <p className="break-words sm:truncate">
                    {split ? t("common.dividedIn", { count: transaction.splits.length }) : first ? counterpartyLabel(first) : ""}
                  </p>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{first ? (ownAccountName(first) ?? "") : ""}</td>
                <td className="px-3 py-2 text-muted-foreground">{category?.name ?? ""}</td>
                <td
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums",
                    first && directionOf(first) === "in" && "text-positive",
                  )}
                >
                  {amount}
                </td>
                <td className="px-3 py-1">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(transaction)}
                      aria-label={t("transactions.table.edit", { title })}
                      className={cn(iconButton, "text-muted-foreground hover:text-foreground")}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpen(transaction)}
                      aria-label={t("transactions.table.editFull", { title })}
                      className={cn(iconButton, "text-muted-foreground hover:text-foreground")}
                    >
                      <Maximize2 className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(transaction)}
                      aria-label={t("transactions.table.delete", { title })}
                      className={cn(iconButton, "text-destructive")}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {bulkDialog === "category" && (
        <BulkCategoryDialog
          count={count}
          categories={categoryList}
          onConfirm={(categoryId) => runBulk({ ids: selectedIds(), action: "set_category", category_id: categoryId }, categoryId === null)}
          onClose={() => setBulkDialog(null)}
        />
      )}
      {bulkDialog === "date" && (
        <BulkDateDialog
          count={count}
          onConfirm={(date) => runBulk({ ids: selectedIds(), action: "set_date", date })}
          onClose={() => setBulkDialog(null)}
        />
      )}
      {bulkDialog === "delete" && (
        <ConfirmDeleteDialog
          title={t("transactions.transactionsTable.excluirLancamentos")}
          itemName={entriesText(count)}
          consequence={t("transactions.transactionsTable.oSaldoDasContas")}
          onConfirm={() => runBulk({ ids: selectedIds(), action: "delete" })}
          onClose={() => setBulkDialog(null)}
        />
      )}
    </div>
  );
}
