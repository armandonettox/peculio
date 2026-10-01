import { Landmark } from "lucide-react";

import { useAuth } from "@/auth/auth-context";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function DashboardPage() {
  const { user } = useAuth();
  const firstName = user?.name.trim().split(/\s+/)[0];

  return (
    <>
      <PageHeader
        title="Painel"
        description={firstName ? `Olá, ${firstName}. Este é o resumo das suas finanças.` : "Resumo das suas finanças"}
      />
      <EmptyState
        icon={Landmark}
        title="Nenhuma conta ainda"
        description="Quando você cadastrar suas contas, o resumo delas aparece aqui."
      />
    </>
  );
}
