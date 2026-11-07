import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/layout/page-header";
import { PlanWizard } from "@/features/planning/plan-wizard";

/** O assistente do planejamento mensal, em tela cheia, no mesmo lugar dos orcamentos. */
export default function PlanWizardPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("pages.budgets.orcamentos")} description={t("planning.wizard.pageDescription")} />
      <PlanWizard />
    </>
  );
}
