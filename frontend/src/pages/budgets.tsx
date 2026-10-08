import { useSearchParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/page-header";
import { Tab, TabList } from "@/components/ui/tabs";
import { BudgetsSection } from "@/features/budgets/budgets-section";
import { EnvelopesSection } from "@/features/envelopes/envelopes-section";
import { useTranslation } from "react-i18next";

type Tab = "budgets" | "envelopes";

export default function BudgetsEnvelopesPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get("aba");
  const tab: Tab = requested === "envelopes" ? "envelopes" : "budgets";

  function chooseTab(next: Tab) {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === "budgets") params.delete("aba");
        else params.set("aba", "envelopes");
        return params;
      },
      { replace: true },
    );
  }

  return (
    <>
      <PageHeader title={t("pages.budgetsEnvelopes.titulo")} description={t("pages.budgetsEnvelopes.descricao")} />

      {/*
        Comparativo sempre visivel: os dois jeitos de orcar sao modelos diferentes, nao a mesma coisa
        com nome trocado. Nao e <h2> de proposito -- cada aba ja tem o proprio h2 com o mesmo nome
      */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-semibold text-primary-text">{t("pages.budgetsEnvelopes.comparacao.orcamentosTitulo")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("pages.budgetsEnvelopes.comparacao.orcamentosTexto")}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-semibold text-primary-text">{t("pages.budgetsEnvelopes.comparacao.envelopesTitulo")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("pages.budgetsEnvelopes.comparacao.envelopesTexto")}</p>
        </div>
      </div>

      <TabList aria-label={t("pages.budgetsEnvelopes.secao")} className="mb-6">
        <Tab active={tab === "budgets"} onSelect={() => chooseTab("budgets")}>
          {t("pages.budgets.orcamentos")}
        </Tab>
        <Tab active={tab === "envelopes"} onSelect={() => chooseTab("envelopes")}>
          {t("pages.envelopes.envelopes")}
        </Tab>
      </TabList>

      {tab === "budgets" ? <BudgetsSection /> : <EnvelopesSection />}
    </>
  );
}
