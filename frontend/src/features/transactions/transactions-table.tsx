import { Keyboard, Lock, Maximize2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useCurrencies, type Account } from "@/api/accounts";
import type { Category } from "@/api/labels";
import { useCreateTransaction, useUpdateTransaction, type Transaction } from "@/api/transactions";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
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
import { ShortcutsDialog } from "./shortcuts-dialog";
import { emptyQuickRow, quickFromTransaction, rowAfterAdd, type QuickColumn, type QuickRow } from "./quick-row";
import { navAction, nextIndex, tabStop } from "./table-nav";

type Props = {
  items: Transaction[];
  categories: Map<string, Category>;
  accounts: Account[];
  // O formulario completo (dividir, outra moeda, tags, orcamento, anexos...)
  onOpen: (transaction: Transaction) => void;
  onRemove: (transaction: Transaction) => void;
};

type Creating = { id: number; initial: QuickRow; focus: QuickColumn };
type Editing = { id: string; row: QuickRow; base: FormState };

/**
 * Os lancamentos em linhas de tabela, para quem lanca e confere muita coisa. Uma parada de Tab so: com o foco na linha,
 * as setas (ou J e K) andam entre as linhas, Home e End vao para as pontas, Enter edita a linha ali mesmo e T abre uma
 * linha de entrada no topo. O que a linha nao mostra (dividir, outra moeda, tags, orcamento...) fica no formulario
 * completo.
 */
export function TransactionsTable({ items, categories, accounts, onOpen, onRemove }: Props) {
  const currencies = useCurrencies();
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Linha que recebe o foco quando o editor fecha
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);
  const newButton = useRef<HTMLButtonElement>(null);
  const stop = tabStop(active, items.length);

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
    if (action.kind === "new") return startNew();
    if (action.kind === "open") return startEdit(items[index]);
    const target = nextIndex(index, items.length, action);
    if (target === null) return;
    setActive(target);
    rows.current[target]?.focus();
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <p className="text-xs text-muted-foreground">Com o foco numa linha: setas ou J e K andam, Enter edita, T cria.</p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setShowShortcuts(true)}>
            <Keyboard />
            Atalhos
          </Button>
          <Button ref={newButton} type="button" size="sm" variant="outline" onClick={startNew}>
            <Plus />
            Nova linha
          </Button>
        </div>
      </div>
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      <table className="w-full min-w-[56rem] text-left text-sm">
        <caption className="sr-only">
          Lançamentos em tabela. Use as setas, J e K para andar entre as linhas, Enter para editar a linha e T para um lançamento novo.
        </caption>
        <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Data
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Descrição
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Contraparte
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Conta
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Categoria
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Valor
            </th>
            <th scope="col" className="w-28 px-3 py-2 font-medium">
              <span className="sr-only">Ações</span>
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
            const total = formatTransactionAmount(transaction);
            const title = transactionTitle(transaction);
            const category = !split && first?.category_id ? categories.get(first.category_id) : undefined;
            return (
              <tr
                key={transaction.id}
                ref={(element) => {
                  rows.current[index] = element;
                }}
                tabIndex={index === stop ? 0 : -1}
                aria-label={`${title}, ${total ?? ""}`.trim()}
                onFocus={() => setActive(index)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className="cursor-default focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDate(transactionDate(transaction))}</td>
                <td className="px-3 py-2 sm:max-w-64">
                  <p className="break-words sm:truncate" title={title}>
                    {title}
                  </p>
                  {state && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {state === "locked" && <Lock className="size-3" aria-hidden="true" />}
                      {state === "locked" ? "Conciliado" : "Conferido"}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground sm:max-w-48">
                  <p className="break-words sm:truncate">
                    {split ? `Dividida em ${transaction.splits.length}` : first ? counterpartyLabel(first) : ""}
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
                  {total}
                </td>
                <td className="px-3 py-1">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(transaction)}
                      aria-label={`Editar ${title}`}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpen(transaction)}
                      aria-label={`Editar completo ${title}`}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Maximize2 className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(transaction)}
                      aria-label={`Excluir ${title}`}
                      className="flex size-8 items-center justify-center rounded-md text-destructive transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    </div>
  );
}
