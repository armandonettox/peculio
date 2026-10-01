import type { Category, Tag } from "@/api/labels";
import type { Transaction, TransactionSplit } from "@/api/transactions";
import { LabelChip } from "@/components/label-chip";
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

export function TransactionRow({ transaction, categories, tags }: { transaction: Transaction } & Lookups) {
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
        {total && (
          <p className={cn("shrink-0 text-base font-semibold tabular-nums", first && amountClass(first))}>{total}</p>
        )}
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
