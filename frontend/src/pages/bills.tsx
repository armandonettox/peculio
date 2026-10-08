import { useSearchParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/page-header";
import { Tab, TabList } from "@/components/ui/tabs";
import { BillsSection } from "@/features/bills/bills-section";
import { RecurrencesSection } from "@/features/recurrences/recurrences-section";
import { useTranslation } from "react-i18next";

type Tab = "bills" | "recurrences";

export default function BillsRecurrencesPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get("aba");
  const tab: Tab = requested === "recorrentes" ? "recurrences" : "bills";

  function chooseTab(next: Tab) {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === "bills") params.delete("aba");
        else params.set("aba", "recorrentes");
        return params;
      },
      { replace: true },
    );
  }

  return (
    <>
      <PageHeader title={t("pages.billsRecurrences.titulo")} description={t("pages.billsRecurrences.descricao")} />

      <TabList aria-label={t("pages.billsRecurrences.secao")} className="mb-6">
        <Tab active={tab === "bills"} onSelect={() => chooseTab("bills")}>
          {t("pages.bills.contasAPagar")}
        </Tab>
        <Tab active={tab === "recurrences"} onSelect={() => chooseTab("recurrences")}>
          {t("pages.recurrences.recorrentes")}
        </Tab>
      </TabList>

      {tab === "bills" ? <BillsSection /> : <RecurrencesSection />}
    </>
  );
}
