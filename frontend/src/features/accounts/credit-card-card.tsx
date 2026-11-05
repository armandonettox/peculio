import { Archive, ArchiveRestore, CreditCard, MoreVertical, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { appToday, firstOfMonth, shiftMonth } from "@/lib/dates";
import type { Account } from "@/api/accounts";
import { useInvoice } from "@/api/invoices";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney, isNegativeMoney, negateMoney, placesOf, sumMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Props = {
  account: Account;
  invoiceMode?: "abertas" | "fechadas";
  onEdit: (account: Account) => void;
  onToggleArchive: (account: Account) => void;
  onDelete: (account: Account) => void;
};

const NETWORK_STYLES: Record<string, { label: string; className: string }> = {
  visa:      { label: "VISA",  className: "bg-blue-700 text-white" },
  mastercard:{ label: "MC",   className: "bg-red-600 text-white" },
  elo:       { label: "ELO",  className: "bg-yellow-500 text-black" },
  amex:      { label: "AMEX", className: "bg-teal-600 text-white" },
  hipercard: { label: "HIPER",className: "bg-red-800 text-white" },
};

function NetworkBadge({ network }: { network: string | null }) {
  if (!network || network === "other" || !(network in NETWORK_STYLES)) return null;
  const { label, className } = NETWORK_STYLES[network];
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide", className)}>
      {label}
    </span>
  );
}

function nextClosingDate(closingDay: number): string {
  const today = appToday();
  const [year, month, day] = today.split("-").map(Number);
  if (day < closingDay) {
    return new Date(Date.UTC(year, month - 1, closingDay)).toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(year, month, closingDay)).toISOString().slice(0, 10);
}

function ClosedInvoiceSummary({ account }: { account: Account }) {
  const { t } = useTranslation();
  const lastMonth = shiftMonth(firstOfMonth(appToday()), -1);
  const invoice = useInvoice({ accountId: account.id, on: lastMonth });

  if (invoice.isPending) {
    return <p className="text-xs text-muted-foreground">{t("common.carregando")}</p>;
  }
  if (invoice.isError || !invoice.data) return null;

  const data = invoice.data;
  const total = isNegativeMoney(data.total) ? negateMoney(data.total) : data.total;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t("accounts.creditCard.faturaFechada")}</span>
        <span className="text-sm font-semibold">{formatMoney(total, data.currency_code)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t("accounts.creditCard.vencimento")}</span>
        <Link to={`/contas/${account.id}/fatura`} className="text-xs text-primary hover:underline">
          {new Date(data.due_date + "T00:00:00Z").toLocaleDateString("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" })}
        </Link>
      </div>
    </div>
  );
}

export function CreditCardCard({ account, invoiceMode = "abertas", onEdit, onToggleArchive, onDelete }: Props) {
  const { t } = useTranslation();
  const fatura = isNegativeMoney(account.balance) ? negateMoney(account.balance) : "0";
  const fechaEm = account.closing_day != null ? nextClosingDate(account.closing_day) : null;

  const places = placesOf(account.currency_code);
  const available = account.credit_limit != null
    ? sumMoney([account.credit_limit, account.balance], places)
    : null;

  const usedNum = parseFloat(fatura.replace(",", "."));
  const limitNum = account.credit_limit != null ? parseFloat(account.credit_limit.replace(",", ".")) : 0;
  const ratio = limitNum > 0 ? Math.min(usedNum / limitNum, 1) : 0;
  const pct = Math.round(ratio * 100);
  const barColor = ratio >= 0.9 ? "bg-destructive" : ratio >= 0.7 ? "bg-yellow-500" : "bg-primary";

  return (
    <li
      className="flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden"
      style={account.color ? { borderLeftColor: account.color, borderLeftWidth: "3px" } : undefined}
    >
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", account.color ? "text-white" : "bg-primary/10 text-primary")}
            style={account.color ? { backgroundColor: account.color } : undefined}
          >
            <CreditCard className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="truncate text-sm font-semibold">{account.name}</h2>
              <NetworkBadge network={account.network} />
              {!account.active && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {t("accounts.accountCard.arquivada")}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {account.currency_code !== "BRL" ? account.currency_code : ""}
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

      <div className="flex flex-col gap-2 px-4 pb-3">
        {invoiceMode === "fechadas" ? (
          <ClosedInvoiceSummary account={account} />
        ) : (
          <>
            <p className={cn(
              "text-xs font-medium",
              isNegativeMoney(account.balance) ? "text-destructive" : "text-muted-foreground"
            )}>
              {isNegativeMoney(account.balance) ? t("accounts.creditCard.faturaAberta") : t("accounts.creditCard.faturaAtual")}
            </p>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t("accounts.creditCard.valorParcial")}</span>
              <span className={cn("text-sm font-semibold", isNegativeMoney(account.balance) && "text-destructive")}>
                {formatMoney(fatura, account.currency_code)}
              </span>
            </div>

            {fechaEm && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("accounts.creditCard.fechaEmLabel")}</span>
                <span className="text-sm text-foreground">
                  {new Date(fechaEm + "T00:00:00Z").toLocaleDateString("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" })}
                </span>
              </div>
            )}

            {account.credit_limit != null && (
              <>
                <div className="mt-1 flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatMoney(fatura, account.currency_code)}</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{t("accounts.accountCard.limiteDisponivel2")}</span>
                  <span className="text-sm font-medium text-green-700 dark:text-green-400">
                    {formatMoney(available!, account.currency_code)}
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {account.active && (
        <Link
          to={`/transacoes?conta=${account.id}`}
          className="flex items-center justify-center gap-1.5 border-t py-2.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors uppercase tracking-wide"
        >
          <Plus className="size-3" />
          {t("accounts.creditCard.adicionarDespesa")}
        </Link>
      )}
    </li>
  );
}
