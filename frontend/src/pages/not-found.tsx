import { SearchX } from "lucide-react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="Página não encontrada" />
      <EmptyState
        icon={SearchX}
        title="Esse endereço não existe"
        description="O link pode estar errado ou a página foi movida."
        action={
          <Button asChild>
            <Link to="/">Voltar ao painel</Link>
          </Button>
        }
      />
    </>
  );
}
