import { SearchX } from "lucide-react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("pages.notFound.paginaNaoEncontrada")} />
      <EmptyState
        icon={SearchX}
        title={t("pages.notFound.esseEnderecoNaoExiste")}
        description={t("pages.notFound.oLinkPodeEstar")}
        action={
          <Button asChild>
            <Link to="/">{t("pages.notFound.voltarAoPainel")}</Link>
          </Button>
        }
      />
    </>
  );
}
