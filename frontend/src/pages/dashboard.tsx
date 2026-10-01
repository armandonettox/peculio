import { Landmark } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Painel" description="Resumo das suas finanças" />
      <EmptyState
        icon={Landmark}
        title="Nenhuma conta ainda"
        description="Quando você cadastrar suas contas, o resumo delas aparece aqui."
      />
    </>
  );
}
