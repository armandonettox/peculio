import { useSearchParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/page-header";
import { Tab, TabList } from "@/components/ui/tabs";
import { ImportSection } from "@/features/imports/import-section";
import { ReconciliationSection } from "@/features/reconciliation/reconciliation-section";
import { useTranslation } from "react-i18next";

type Tab = "import" | "reconciliation";

export default function ImportReconciliationPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get("aba");
  const tab: Tab = requested === "conciliar" ? "reconciliation" : "import";

  function chooseTab(next: Tab) {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === "import") params.delete("aba");
        else params.set("aba", "conciliar");
        return params;
      },
      { replace: true },
    );
  }

  return (
    <>
      <PageHeader title={t("pages.importConciliar.titulo")} description={t("pages.importConciliar.descricao")} />

      <TabList aria-label={t("pages.importConciliar.secao")} className="mb-6">
        <Tab active={tab === "import"} onSelect={() => chooseTab("import")}>
          {t("pages.import.importarExtrato")}
        </Tab>
        <Tab active={tab === "reconciliation"} onSelect={() => chooseTab("reconciliation")}>
          {t("pages.reconciliation.conciliar")}
        </Tab>
      </TabList>

      {tab === "import" ? <ImportSection /> : <ReconciliationSection />}
    </>
  );
}
