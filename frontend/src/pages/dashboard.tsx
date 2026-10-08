import { Landmark } from "lucide-react";
import { Link } from "react-router-dom";

import { useAccounts } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { useAuth } from "@/auth/auth-context";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { MasonryColumns } from "@/components/masonry-columns";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertsBar } from "@/features/dashboard/alerts-bar";
import { BudgetsBlock } from "@/features/dashboard/budgets-block";
import { CategoryBlock } from "@/features/dashboard/category-block";
import { NetWorthBlock } from "@/features/dashboard/net-worth-block";
import { PiggyBanksBlock } from "@/features/dashboard/piggy-banks-block";
import { ThisMonthBlock } from "@/features/dashboard/this-month-block";
import { TransactionsBlock } from "@/features/dashboard/transactions-block";
import { UpcomingBlock } from "@/features/dashboard/upcoming-block";
import { appToday } from "@/lib/dates";
import { useTranslation } from "react-i18next";

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const firstName = user?.name.trim().split(/\s+/)[0];
  const today = appToday();

  // Enquanto nao houver nenhuma conta, o painel nao tem o que mostrar: nem dispara os
  // pedidos dos outros blocos (todos dependem, direto ou indireto, de uma conta existir)
  const accounts = useAccounts({ includeArchived: true });
  const hasAccounts = (accounts.data?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title={t("pages.dashboard.painel")}
        description={firstName ? t("pages.dashboard.greeting", { name: firstName }) : t("pages.dashboard.resumoDasSuasFinancas")}
      />

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
          <AlertsBar />
          <div className="mb-6">
            <NetWorthBlock />
          </div>
          {/*
            Colunas que se encaixam pela altura real de cada bloco, sem buraco ao lado de um bloco curto
            nem sobra no fim de uma coluna mais curta. A ordem do HTML continua a de leitura, so o lugar
            visual na grade e que se ajusta (ver MasonryColumns).
          */}
          <MasonryColumns className="grid-cols-1 lg:grid-cols-2" data-testid="dashboard-columns">
            <ThisMonthBlock />
            <CategoryBlock />
            <BudgetsBlock today={today} />
            <UpcomingBlock />
            <TransactionsBlock />
            <PiggyBanksBlock />
          </MasonryColumns>
        </>
      )}
    </>
  );
}
