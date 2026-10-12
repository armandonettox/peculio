import { PageHeader } from "@/components/layout/page-header";
import { BudgetsSection } from "@/features/budgets/budgets-section";
import { useTranslation } from "react-i18next";

export default function BudgetsPage() {
  const { t } = useTranslation();

  return (
    <>
      <PageHeader title={t("pages.budgets.orcamentos")} description={t("pages.budgets.quantoVoceJaUsou")} />
      <BudgetsSection />
    </>
  );
}
