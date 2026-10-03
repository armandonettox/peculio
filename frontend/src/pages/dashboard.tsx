import { Landmark } from "lucide-react";
import { Link } from "react-router-dom";

import { useAccounts } from "@/api/accounts";
import { useAuth } from "@/auth/auth-context";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { AlertsBar } from "@/features/dashboard/alerts-bar";
import { BudgetsBlock } from "@/features/dashboard/budgets-block";
import { CategoryBlock } from "@/features/dashboard/category-block";
import { NetWorthBlock } from "@/features/dashboard/net-worth-block";
import { PiggyBanksBlock } from "@/features/dashboard/piggy-banks-block";
import { ThisMonthBlock } from "@/features/dashboard/this-month-block";
import { TransactionsBlock } from "@/features/dashboard/transactions-block";
import { UpcomingBlock } from "@/features/dashboard/upcoming-block";
import { todayLocal } from "@/lib/dates";

export default function DashboardPage() {
  const { user } = useAuth();
  const firstName = user?.name.trim().split(/\s+/)[0];
  const today = todayLocal();

  // Enquanto nao houver nenhuma conta, o painel nao tem o que mostrar: nem dispara os
  // pedidos dos outros blocos (todos dependem, direto ou indireto, de uma conta existir)
  const accounts = useAccounts({ includeArchived: true });
  const hasAccounts = (accounts.data?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Painel"
        description={firstName ? `Olá, ${firstName}. Este é o resumo das suas finanças.` : "Resumo das suas finanças"}
      />

      {accounts.isPending ? (
        <div aria-busy="true" className="h-32 animate-pulse rounded-lg border bg-muted" />
      ) : !hasAccounts ? (
        <EmptyState
          icon={Landmark}
          title="Nenhuma conta ainda"
          description="Quando você cadastrar suas contas, o resumo delas aparece aqui."
          action={
            <Button asChild>
              <Link to="/contas">Cadastrar conta</Link>
            </Button>
          }
        />
      ) : (
        <>
          <AlertsBar />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <NetWorthBlock />
            <ThisMonthBlock />
            <CategoryBlock />
            <BudgetsBlock today={today} />
            <UpcomingBlock />
            <TransactionsBlock />
            <PiggyBanksBlock />
          </div>
        </>
      )}
    </>
  );
}
