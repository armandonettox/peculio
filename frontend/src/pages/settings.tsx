import { useSearchParams } from "react-router-dom";

import { useAuth } from "@/auth/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Tab, TabList } from "@/components/ui/tabs";
import { DashboardSection } from "@/features/settings/dashboard-section";
import { AppearanceSection } from "@/features/settings/appearance-section";
import { InvitesSection } from "@/features/settings/invites-section";
import { ProfileSection } from "@/features/settings/profile-section";
import { SecurityContactSection } from "@/features/settings/security-contact-section";
import { SecuritySection } from "@/features/settings/security-section";
import { WebhooksSection } from "@/features/webhooks/webhooks-section";
import { useTranslation } from "react-i18next";

type Tab = "perfil" | "aparencia" | "painel" | "seguranca" | "webhooks" | "administracao";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get("aba");
  // "administracao" so vale para quem e admin; qualquer outro valor (ou nenhum) cai em "perfil"
  const tab: Tab =
    requested === "administracao" && user?.is_admin
      ? "administracao"
      : requested === "aparencia" || requested === "painel" || requested === "seguranca" || requested === "webhooks"
        ? requested
        : "perfil";

  function chooseTab(next: Tab) {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === "perfil") params.delete("aba");
        else params.set("aba", next);
        return params;
      },
      { replace: true },
    );
  }

  return (
    <>
      <PageHeader title={t("pages.settings.configuracoes")} description={t("pages.settings.seuPerfilSenhaAparencia")} />

      <TabList aria-label={t("pages.settings.secaoDeConfiguracoes")} className="mb-6">
        <Tab active={tab === "perfil"} onSelect={() => chooseTab("perfil")}>
          {t("pages.settings.perfil")}
        </Tab>
        <Tab active={tab === "aparencia"} onSelect={() => chooseTab("aparencia")}>
          {t("pages.settings.aparencia")}
        </Tab>
        <Tab active={tab === "painel"} onSelect={() => chooseTab("painel")}>
          {t("dashboard.settings.tab")}
        </Tab>
        <Tab active={tab === "seguranca"} onSelect={() => chooseTab("seguranca")}>
          {t("common.seguranca")}
        </Tab>
        <Tab active={tab === "webhooks"} onSelect={() => chooseTab("webhooks")}>
          {t("pages.webhooks.webhooks")}
        </Tab>
        {user?.is_admin && (
          <Tab active={tab === "administracao"} onSelect={() => chooseTab("administracao")}>
            {t("pages.settings.administracao")}
          </Tab>
        )}
      </TabList>

      {tab === "perfil" && <ProfileSection />}

      {tab === "aparencia" && <AppearanceSection />}

      {tab === "painel" && <DashboardSection />}

      {tab === "seguranca" && <SecuritySection />}

      {tab === "webhooks" && <WebhooksSection />}

      {tab === "administracao" && user?.is_admin && (
        <div className="grid gap-6 xl:grid-cols-2 [&>*]:h-full">
          <InvitesSection />
          <SecurityContactSection />
        </div>
      )}
    </>
  );
}
