import { MoreVertical, Pencil } from "lucide-react";

import type { Category, Tag } from "@/api/labels";
import type { Transaction, TransactionSplit } from "@/api/transactions";
import { LabelChip } from "@/components/label-chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  counterpartyLabel,
  directionOf,
  foreignNote,
  formatSplitAmount,
  formatTransactionAmount,
  ownAccountName,
  transactionTitle,
} from "./presentation";

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

type RowProps = { transaction: Transaction; onEdit: (transaction: Transaction) => void } & Lookups;

export function TransactionRow({ transaction, categories, tags, onEdit }: RowProps) {
  const splits = transaction.splits;
  const isSplit = splits.length > 1;
  const total = formatTransactionAmount(transaction);
  const [first] = splits;

  return (
    <li className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Quebra de linha em vez de cortar: o valor de uma transferencia entre moedas e largo */}
          <p className="break-words font-medium">{transactionTitle(transaction)}</p>
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
              Dividida em {splits.length}
              {ownAccountName(first) ? ` · ${ownAccountName(first)}` : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          {total && (
            <p className={cn("text-base font-semibold tabular-nums", first && amountClass(first))}>{total}</p>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Ações do lançamento ${transactionTitle(transaction)}`}
                className="-mr-2 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onSelect={() => onEdit(transaction)}>
                <Pencil />
                Editar
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
