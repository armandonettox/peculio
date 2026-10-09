import { Lock, MoreVertical, Paperclip, Pencil, Trash2 } from "lucide-react";

import type { Category, Tag } from "@/api/labels";
import type { Transaction, TransactionSplit } from "@/api/transactions";
import { LabelChip } from "@/components/label-chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  counterpartyLabel,
  directionOf,
  foreignNote,
  formatSplitAmount,
  formatTransactionAmount,
  installmentText,
  ownAccountName,
  reconciliationState,
  transactionTitle,
} from "./presentation";
import { useTranslation } from "react-i18next";

type Lookups = {
  categories: Map<string, Category>;
  tags: Map<string, Tag>;
};

function amountClass(split: Pick<TransactionSplit, "type">) {
  // Entrada em verde; saida e transferencia na cor normal (o sinal ja diz o sentido)
  return directionOf(split) === "in" ? "text-positive" : "text-foreground";
}

function Labels({ split, categories, tags }: { split: TransactionSplit } & Lookups) {
  const category = split.category_id ? categories.get(split.category_id) : undefined;
  const splitTags = split.tag_ids.map((id) => tags.get(id)).filter((tag): tag is Tag => tag !== undefined);
  if (!category && splitTags.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {category && <LabelChip name={category.name} color={category.color} />}
      {splitTags.map((tag) => (
        <LabelChip key={tag.id} name={`#${tag.name}`} className="bg-transparent" />
      ))}
    </div>
  );
}

type RowProps = {
  transaction: Transaction;
  onEdit: (transaction: Transaction) => void;
  onRemove: (transaction: Transaction) => void;
  onAttachments: (transaction: Transaction) => void;
} & Lookups;

export function TransactionRow({ transaction, categories, tags, onEdit, onRemove, onAttachments }: RowProps) {
  const { t } = useTranslation();
  const splits = transaction.splits;
  const isSplit = splits.length > 1;
  const total = formatTransactionAmount(transaction);
  const [first] = splits;
  const reconciliation = reconciliationState(transaction);

  return (
    <li className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Quebra de linha em vez de cortar: o valor de uma transferencia entre moedas e largo */}
          <p className="break-words font-medium">
            {transactionTitle(transaction)}
            {transaction.installment_count != null && transaction.installment_index != null && (
              <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                {installmentText(transaction.installment_index, transaction.installment_count)}
              </span>
            )}
          </p>
          {reconciliation && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              {reconciliation === "locked" && <Lock className="size-3" aria-hidden="true" />}
              {reconciliation === "locked" ? t("transactions.transactionRow.conciliado") : t("transactions.transactionRow.conferido")}
            </p>
          )}
          {!isSplit && first && (
            <>
              <p className="text-sm text-muted-foreground">
                {counterpartyLabel(first)}
                {ownAccountName(first) ? ` · ${ownAccountName(first)}` : ""}
              </p>
              {foreignNote(first) && <p className="text-xs text-muted-foreground">{foreignNote(first)}</p>}
              <Labels split={first} categories={categories} tags={tags} />
            </>
          )}
          {isSplit && (
            <p className="text-sm text-muted-foreground">
              {t("common.dividedIn", { count: splits.length })}
              {ownAccountName(first) ? ` · ${ownAccountName(first)}` : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          {transaction.attachment_count > 0 && (
            <button
              type="button"
              onClick={() => onAttachments(transaction)}
              aria-label={t("transactions.row.attachments", { count: transaction.attachment_count, title: transactionTitle(transaction) })}
              className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Paperclip className="size-3.5" aria-hidden="true" />
              {transaction.attachment_count}
            </button>
          )}
          {total && (
            <p className={cn("text-base font-semibold tabular-nums", first && amountClass(first))}>{total}</p>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("transactions.row.actions", { title: transactionTitle(transaction) })}
                className="-mr-2 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onSelect={() => onEdit(transaction)}>
                <Pencil />
                {t("common.editar")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAttachments(transaction)}>
                <Paperclip />
                {t("transactions.transactionRow.anexos")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onRemove(transaction)} className="text-destructive">
                <Trash2 />
                {t("common.excluir")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isSplit && (
        <ul className="mt-3 flex flex-col gap-2 border-t pt-3">
          {splits.map((split) => (
            <li key={split.id} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="break-words">{split.description}</p>
                <p className="text-xs text-muted-foreground">{counterpartyLabel(split)}</p>
                <Labels split={split} categories={categories} tags={tags} />
              </div>
              <p className={cn("shrink-0 tabular-nums", amountClass(split))}>{formatSplitAmount(split)}</p>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
