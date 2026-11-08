import { Heart } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAccounts, useCurrencies } from "@/api/accounts";
import { useFavorites } from "@/api/favorites";
import { useCategories } from "@/api/labels";
import { useAuth } from "@/auth/auth-context";
import { formatMoney, isNegativeMoney, negateMoney, placesOf, sumMoney } from "@/lib/money";
import type { MonthRange } from "@/lib/month";
import { appToday } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DashboardBlock } from "./dashboard-block";
import { recentLine } from "./presentation";
import { useMonthTransactions } from "./use-month-transactions";

const LINK_CLASS = "mt-4 inline-block text-sm font-medium text-primary-text hover:underline";
const MAX_LINES = 6;

/** Os lancamentos do mes que ainda nao foram efetivados (pendentes), os primeiros da lista. */
export function PendingBlock({ range }: { range: MonthRange }) {
  const { t } = useTranslation();
  const { query, items } = useMonthTransactions(range, { status: "pending" });
  const categories = useCategories({ search: "" });
  const categoryMap = new Map((categories.data?.items ?? []).map((category) => [category.id, category]));
  const today = appToday();
  const lines = items.slice(0, MAX_LINES).map((item) => recentLine(item, categoryMap, today));

  return (
    <DashboardBlock
      title={t("dashboard.pendingBlock.title")}
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={lines.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.pendingBlock.empty")}</p>}
    >
      <ul className="flex flex-col divide-y">
        {lines.map((line) => (
          <li key={line.id} className="flex items-baseline gap-3 py-2 text-sm first:pt-0">
            <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">{line.date}</span>
            <p className="min-w-0 flex-1 truncate font-medium">{line.title}</p>
            {line.amount && (
              <span className={cn("shrink-0 font-medium tabular-nums", line.direction === "in" && "text-positive")}>{line.amount}</span>
            )}
          </li>
        ))}
      </ul>
      <Link to={`/transacoes?situacao=pending&de=${range.from}&ate=${range.to}`} className={LINK_CLASS}>
        {t("dashboard.verMais")}
      </Link>
    </DashboardBlock>
  );
}

/** Os favoritos (descricoes que a pessoa marcou), de saida e de entrada. */
export function FavoritesBlock() {
  const { t } = useTranslation();
  const expenses = useFavorites("withdrawal");
  const incomes = useFavorites("deposit");
  const categories = useCategories({ search: "" });
  const categoryMap = new Map((categories.data?.items ?? []).map((category) => [category.id, category.name]));
  const items = [...(expenses.data ?? []), ...(incomes.data ?? [])];

  return (
    <DashboardBlock
      title={t("dashboard.favoritesBlock.title")}
      isLoading={expenses.isPending || incomes.isPending}
      isError={expenses.isError || incomes.isError}
      error={expenses.error ?? incomes.error}
      onRetry={() => {
        void expenses.refetch();
        void incomes.refetch();
      }}
      isEmpty={items.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.favoritesBlock.empty")}</p>}
    >
      <ul className="flex flex-col divide-y">
        {items.slice(0, MAX_LINES).map((item) => (
          <li key={item.id} className="flex items-center gap-2 py-2 text-sm first:pt-0">
            <Heart className="size-4 shrink-0 text-destructive" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">{item.description}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {item.category_id ? (categoryMap.get(item.category_id) ?? "") : ""}
            </span>
          </li>
        ))}
      </ul>
    </DashboardBlock>
  );
}

/** As contas (sem os cartoes) com o saldo de cada uma. */
export function AccountsBlock() {
  const { t } = useTranslation();
  const query = useAccounts({ includeArchived: false });
  const items = (query.data ?? []).filter((account) => account.role !== "credit_card");

  return (
    <DashboardBlock
      title={t("dashboard.accountsBlock.title")}
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={items.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.accountsBlock.empty")}</p>}
    >
      <ul className="flex flex-col divide-y">
        {items.map((account) => (
          <li key={account.id} className="flex items-baseline justify-between gap-3 py-2 text-sm first:pt-0">
            <span className="min-w-0 truncate font-medium">{account.name}</span>
            <span className={cn("shrink-0 tabular-nums", isNegativeMoney(account.balance) && "text-destructive")}>
              {formatMoney(account.balance, account.currency_code)}
            </span>
          </li>
        ))}
      </ul>
      <Link to="/contas" className={LINK_CLASS}>
        {t("dashboard.verMais")}
      </Link>
    </DashboardBlock>
  );
}

/** Os cartoes de credito: fatura em aberto, barra de uso do limite e limite disponivel. */
export function CreditCardsBlock() {
  const { t } = useTranslation();
  const query = useAccounts({ includeArchived: false });
  const currencyList = useCurrencies();
  const places = Object.fromEntries((currencyList.data ?? []).map((item) => [item.code, item.decimal_places]));
  const cards = (query.data ?? []).filter((account) => account.role === "credit_card");

  return (
    <DashboardBlock
      title={t("dashboard.creditCardsBlock.title")}
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={cards.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.creditCardsBlock.empty")}</p>}
    >
      <ul className="flex flex-col gap-4">
        {cards.map((card) => {
          const debt = isNegativeMoney(card.balance) ? negateMoney(card.balance) : "0";
          const limit = card.credit_limit;
          const available = limit == null ? null : sumMoney([limit, card.balance], placesOf(card.currency_code, places));
          const percent = limit != null && Number(limit) > 0 ? Math.min(100, Math.round((Number(debt) / Number(limit)) * 100)) : null;
          return (
            <li key={card.id} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium">{card.name}</p>
                <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(debt, card.currency_code)}</p>
              </div>
              {percent !== null && (
                <div
                  role="progressbar"
                  aria-label={t("dashboard.creditCardsBlock.limitUsed", { name: card.name })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
                >
                  <div className={cn("h-full rounded-full", percent >= 90 ? "bg-destructive" : percent >= 70 ? "bg-warning" : "bg-primary-text")} style={{ width: `${percent}%` }} />
                </div>
              )}
              {available !== null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("dashboard.creditCardsBlock.available", { amount: formatMoney(available, card.currency_code) })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <Link to="/cartoes" className={LINK_CLASS}>
        {t("dashboard.verMais")}
      </Link>
    </DashboardBlock>
  );
}

/** Quem esta usando o app: nome, e-mail e um atalho para as configuracoes. */
export function ProfileBlock() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const initials = (user?.name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <DashboardBlock title={t("dashboard.profileBlock.title")} isLoading={false} isError={false} onRetry={() => undefined}>
      <div className="flex items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </div>
      </div>
      <Link to="/configuracoes" className={LINK_CLASS}>
        {t("dashboard.profileBlock.settings")}
      </Link>
    </DashboardBlock>
  );
}
