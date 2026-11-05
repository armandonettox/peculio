import { CreditCard, Receipt } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import type { Account } from "@/api/accounts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney, isNegativeMoney, negateMoney, placesOf, sumMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Archive, ArchiveRestore, MoreVertical, Pencil, Trash2 } from "lucide-react";

type Props = {
  account: Account;
  onEdit: (account: Account) => void;
  onToggleArchive: (account: Account) => void;
  onDelete: (account: Account) => void;
};

function LimitBar({ used, limit, currency }: { used: string; limit: string; currency: string }) {
  const { t } = useTranslation();
  const places = placesOf(currency);

  // used = valor negativo (divida); limit = positivo
  const usedAbs = isNegativeMoney(used) ? negateMoney(used) : used;
  const available = sumMoney([limit, used], places);

  const usedNum = parseFloat(usedAbs.replace(",", "."));
  const limitNum = parseFloat(limit.replace(",", "."));
  const ratio = limitNum > 0 ? Math.min(usedNum / limitNum, 1) : 0;
  const pct = Math.round(ratio * 100);

  const barColor =
    ratio >= 0.9 ? "bg-destructive" : ratio >= 0.7 ? "bg-yellow-500" : "bg-primary";

  return (
    <div className="mt-3 flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{t("accounts.creditCard.usado", { value: formatMoney(usedAbs, currency) })}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{t("accounts.creditCard.disponivel", { value: formatMoney(available, currency) })}</span>
        <span>{t("accounts.creditCard.limite", { value: formatMoney(limit, currency) })}</span>
      </div>
    </div>
  );
}

export function CreditCardCard({ account, onEdit, onToggleArchive, onDelete }: Props) {
  const { t } = useTranslation();
  const fatura = isNegativeMoney(account.balance) ? negateMoney(account.balance) : "0";

  return (
    <li className="flex flex-col rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CreditCard className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{account.name}</h3>
            {!account.active && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {t("accounts.accountCard.arquivada")}
              </span>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("accounts.accountCard.actionsFor", { name: account.name })}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem asChild>
              <Link to={`/contas/${account.id}/fatura`}>
                <Receipt />
                {t("accounts.accountCard.verFatura")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEdit(account)}>
              <Pencil />
              {t("common.editar")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleArchive(account)}>
              {account.active ? <Archive /> : <ArchiveRestore />}
              {account.active ? t("accounts.accountCard.arquivar") : t("accounts.accountCard.restaurar")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDelete(account)} className="text-destructive">
              <Trash2 />
              {t("common.excluir")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-3">
        <p className="text-xs text-muted-foreground">{t("accounts.creditCard.faturaAtual")}</p>
        <p className={cn("text-2xl font-semibold tracking-tight", isNegativeMoney(account.balance) && "text-destructive")}>
          {formatMoney(fatura, account.currency_code)}
        </p>
      </div>

      {account.credit_limit != null && (
        <LimitBar
          used={account.balance}
          limit={account.credit_limit}
          currency={account.currency_code}
        />
      )}
    </li>
  );
}
