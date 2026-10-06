import { Archive, ArchiveRestore, MoreVertical, Pencil, Trash2 } from "lucide-react";

import type { Account } from "@/api/accounts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney, isNegativeMoney, negateMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "./labels";

type AccountCardProps = {
  account: Account;
  onEdit: (account: Account) => void;
  onToggleArchive: (account: Account) => void;
  onDelete: (account: Account) => void;
};

export function AccountCard({ account, onEdit, onToggleArchive, onDelete }: AccountCardProps) {
  const isLiability = account.type === "liability";
  // No livro-caixa a divida e saldo negativo; na tela mostramos o valor devido, positivo
  const shown = isLiability ? negateMoney(account.balance) : account.balance;
  const negative = !isLiability && isNegativeMoney(account.balance);

  return (
    <li
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm",
        !account.active && "opacity-70",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 max-w-full truncate text-base font-semibold">{account.name}</h3>
          {!account.active && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Arquivada</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {account.role ? ROLE_LABELS[account.role] : ""}
          {account.currency_code !== "BRL" ? ` · ${account.currency_code}` : ""}
        </p>
        <p className={cn("mt-2 text-2xl font-semibold tracking-tight", negative && "text-destructive")}>
          {formatMoney(shown, account.currency_code)}
        </p>
        {isLiability && <p className="text-xs text-muted-foreground">Valor devido</p>}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Ações da conta ${account.name}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreVertical className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onSelect={() => onEdit(account)}>
            <Pencil />
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggleArchive(account)}>
            {account.active ? <Archive /> : <ArchiveRestore />}
            {account.active ? "Arquivar" : "Restaurar"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onDelete(account)} className="text-destructive">
            <Trash2 />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
