import { Archive, ArchiveRestore, Landmark, List, MoreVertical, Pencil, Plus, Receipt, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import type { Account } from "@/api/accounts";
import { BalanceAdjustDialog } from "./balance-adjust-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney, isNegativeMoney, negateMoney, placesOf, sumMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { roleLabel } from "./labels";

type AccountCardProps = {
  account: Account;
  onEdit: (account: Account) => void;
  onToggleArchive: (account: Account) => void;
  onDelete: (account: Account) => void;
};

export function AccountCard({ account, onEdit, onToggleArchive, onDelete }: AccountCardProps) {
  const { t } = useTranslation();
  const [showAdjust, setShowAdjust] = useState(false);
  const isLiability = account.type === "liability";
  const shown = isLiability ? negateMoney(account.balance) : account.balance;
  const isNegative = !isLiability && isNegativeMoney(account.balance);
  const isPositive = !isLiability && !isNegativeMoney(account.balance);

  return (<>
    <li
      className="flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden"
      style={account.color ? { borderLeftColor: account.color, borderLeftWidth: "3px" } : undefined}
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", account.color ? "text-white" : "bg-primary/10 text-primary-text")}
            style={account.color ? { backgroundColor: account.color } : undefined}
          >
            <Landmark className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="truncate text-sm font-semibold">{account.name}</h2>
              {!account.active && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t("accounts.accountCard.arquivada")}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {account.role ? roleLabel(account.role) : ""}
              {account.currency_code !== "BRL" ? ` · ${account.currency_code}` : ""}
            </p>
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
            {account.role === "credit_card" && (
              <DropdownMenuItem asChild>
                <Link to={`/contas/${account.id}/fatura`}>
                  <Receipt />
                  {t("accounts.accountCard.verFatura")}
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link to={`/transacoes?conta=${account.id}`}>
                <List />
                {t("accounts.accountCard.verTransacoes")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShowAdjust(true)}>
              <SlidersHorizontal />
              {t("accounts.accountCard.reajustarSaldo")}
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

      <div className="flex flex-col gap-2 px-4 pb-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{isLiability ? t("accounts.accountCard.valorDevido") : t("pages.accounts.saldoAtual")}</span>
          <span className={cn("text-sm font-semibold", isNegative && "text-destructive", isPositive && "text-green-700 dark:text-green-400")}>
            {formatMoney(shown, account.currency_code)}
          </span>
        </div>

        {account.role === "credit_card" && account.credit_limit != null && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t("accounts.accountCard.limiteDisponivel2")}</span>
            <span className="text-sm font-medium text-green-700 dark:text-green-400">
              {formatMoney(sumMoney([account.credit_limit, account.balance], placesOf(account.currency_code)), account.currency_code)}
            </span>
          </div>
        )}
      </div>

      {account.active && (
        <Link
          to={`/transacoes?conta=${account.id}`}
          className="flex items-center justify-center gap-1.5 border-t py-2.5 text-xs font-medium text-primary-text hover:bg-primary/5 transition-colors uppercase tracking-wide"
        >
          <Plus className="size-3" />
          {t("accounts.accountCard.adicionarDespesa")}
        </Link>
      )}
    </li>

    {showAdjust && <BalanceAdjustDialog account={account} onClose={() => setShowAdjust(false)} />}
  </>);
}
