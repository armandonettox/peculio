import { Landmark } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useAccounts } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { useAuth } from "@/auth/auth-context";
import { InstallBanner } from "@/components/install-banner";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { MonthPicker } from "@/components/month-picker";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertsBar } from "@/features/dashboard/alerts-bar";
import { readLayout, type DashboardCardId } from "@/features/dashboard/cards";
import { MobileHome } from "@/features/dashboard/mobile-home";
import { FirstStepsBlock } from "@/features/dashboard/first-steps-block";
import { AccountsBlock, CreditCardsBlock, FavoritesBlock, PendingBlock, ProfileBlock } from "@/features/dashboard/list-blocks";
import { CalendarBlock, FrequencyBlock, PeriodBalanceBlock, SavingsBlock } from "@/features/dashboard/month-blocks";
import { SummaryCards } from "@/features/dashboard/summary-cards";
import { BudgetsBlock } from "@/features/dashboard/budgets-block";
import { CategoryBlock } from "@/features/dashboard/category-block";
import { NetWorthBlock } from "@/features/dashboard/net-worth-block";
import { PiggyBanksBlock } from "@/features/dashboard/piggy-banks-block";
import { ThisMonthBlock } from "@/features/dashboard/this-month-block";
import { TransactionsBlock } from "@/features/dashboard/transactions-block";
import { UpcomingBlock } from "@/features/dashboard/upcoming-block";
import { appToday } from "@/lib/dates";
import { monthRange, type MonthRange } from "@/lib/month";
import { useTranslation } from "react-i18next";

/** O dia que vale como "hoje" para os orcamentos do mes escolhido: hoje no mes atual, senao o ultimo ou o primeiro dia dele. */
function budgetDay(range: MonthRange, today: string): string {
  if (today >= range.from && today <= range.to) return today;
  return today > range.to ? range.to : range.from;
}

function renderCard(id: DashboardCardId, range: MonthRange, today: string) {
  switch (id) {
    case "expensesByCategory":
      return <CategoryBlock range={range} />;
    case "incomeByCategory":
      return <CategoryBlock range={range} kind="income" />;
    case "spendingFrequency":
      return <FrequencyBlock range={range} />;
    case "monthlyBalance":
      return <ThisMonthBlock range={range} />;
    case "pendingTransactions":
      return <PendingBlock range={range} />;
    case "budgetSummary":
      return <BudgetsBlock today={budgetDay(range, today)} />;
    case "favorites":
      return <FavoritesBlock />;
    case "calendar":
      return <CalendarBlock range={range} />;
    case "accounts":
      return <AccountsBlock />;
    case "upcoming":
      return <UpcomingBlock />;
    case "recentTransactions":
      return <TransactionsBlock />;
    case "semesterBalance":
      return <PeriodBalanceBlock range={range} months={6} />;
    case "quarterBalance":
      return <PeriodBalanceBlock range={range} months={3} />;
    case "creditCards":
      return <CreditCardsBlock />;
    case "goals":
      return <PiggyBanksBlock />;
    case "savings":
      return <SavingsBlock range={range} />;
    case "profile":
      return <ProfileBlock />;
    case "netWorth":
      return <NetWorthBlock />;
  }
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const firstName = user?.name.trim().split(/\s+/)[0];
  const today = appToday();
  const [month, setMonth] = useState(() => monthRange(today).month);
  const range = monthRange(month);
  const currentMonth = monthRange(today).month;
  const [layout] = useState(readLayout);
  // Abaixo de 1024 px e a tela inicial do celular (topo com saldo, sem sidebar); acima, o painel de sempre
  const desktop = useMediaQuery("(min-width: 1024px)");

  // Enquanto nao houver nenhuma conta, o painel nao tem o que mostrar: nem dispara os
  // pedidos dos outros blocos (todos dependem, direto ou indireto, de uma conta existir)
  const accounts = useAccounts({ includeArchived: true });
  const hasAccounts = (accounts.data?.length ?? 0) > 0;

  // No celular, com contas cadastradas, o topo e o do Mobills (avatar, mes, saldo); sem contas fica o cabecalho de sempre
  const mobileHome = !desktop && hasAccounts;

  return (
    <>
      {mobileHome ? (
        <MobileHome range={range} currentMonth={currentMonth} onMonthChange={setMonth} />
      ) : (
        <>
          {/* O seletor de mes fica no meio da pagina, no alto, como no Mobills */}
          {hasAccounts && (
            <div className="mb-4 flex justify-center">
              <MonthPicker value={month} currentMonth={currentMonth} onChange={setMonth} />
            </div>
          )}
          <PageHeader
            title={t("pages.dashboard.painel")}
            description={firstName ? t("pages.dashboard.greeting", { name: firstName }) : t("pages.dashboard.resumoDasSuasFinancas")}
          />
        </>
      )}

      <InstallBanner />

      {accounts.isPending ? (
        <div aria-busy="true" className="h-32 animate-pulse rounded-lg border bg-muted" />
      ) : accounts.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="destructive" className="w-full">
            {getErrorMessage(accounts.error)}
          </Alert>
          <Button variant="outline" size="sm" onClick={() => accounts.refetch()}>
            {t("common.tentarDeNovo")}
          </Button>
        </div>
      ) : !hasAccounts ? (
        <EmptyState
          icon={Landmark}
          title={t("pages.dashboard.nenhumaContaAinda")}
          description={t("pages.dashboard.quandoVoceCadastrarSuas")}
          action={
            <Button asChild>
              <Link to="/contas">{t("pages.dashboard.cadastrarConta")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* No celular os alertas e os totais ja estao no topo (MobileHome) */}
          {!mobileHome && (
            <>
              <AlertsBar />
              <div className="mb-6">
                <SummaryCards range={range} />
              </div>
            </>
          )}
          {/*
            Duas colunas independentes, cada uma empilhando os blocos que a pessoa deixou ligados em
            "Gerenciar tela inicial". Os dois lados sobem juntos quando a tela e estreita.
          */}
          <div className={`grid grid-cols-1 items-start gap-4 lg:grid-cols-2 ${mobileHome ? "mt-6" : ""}`} data-testid="dashboard-columns">
            <div className="flex min-w-0 flex-col gap-4" data-testid="dashboard-left">
              <FirstStepsBlock />
              {layout.left.filter((id) => layout.enabled.includes(id) && !(mobileHome && id === "accounts")).map((id) => (
                <div key={id} className="min-w-0">
                  {renderCard(id, range, today)}
                </div>
              ))}
            </div>
            <div className="flex min-w-0 flex-col gap-4" data-testid="dashboard-right">
              {layout.right.filter((id) => layout.enabled.includes(id) && !(mobileHome && id === "accounts")).map((id) => (
                <div key={id} className="min-w-0">
                  {renderCard(id, range, today)}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6">
            <Button asChild variant="outline" size="sm">
              <Link to="/configuracoes?aba=painel">{t("dashboard.manageHome")}</Link>
            </Button>
          </div>
        </>
      )}
    </>
  );
}
