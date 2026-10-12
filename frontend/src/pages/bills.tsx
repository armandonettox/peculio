import { PageHeader } from "@/components/layout/page-header";
import { RecurrencesSection } from "@/features/recurrences/recurrences-section";
import { useTranslation } from "react-i18next";

export default function RecurrencesPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("pages.recurrences.titulo")} description={t("pages.recurrences.descricao")} />
      <RecurrencesSection />
    </>
  );
}
