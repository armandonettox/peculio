import { useSearchParams } from "react-router-dom";

import { useAuth } from "@/auth/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Tab, TabList } from "@/components/ui/tabs";
import { AppearanceSection } from "@/features/settings/appearance-section";
import { InvitesSection } from "@/features/settings/invites-section";
import { PasswordSection } from "@/features/settings/password-section";
import { ProfileSection } from "@/features/settings/profile-section";
import { SecurityContactSection } from "@/features/settings/security-contact-section";
import { SecuritySection } from "@/features/settings/security-section";
import { useTranslation } from "react-i18next";

type Tab = "perfil" | "aparencia" | "seguranca" | "administracao";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get("aba");
  // "administracao" so vale para quem e admin; qualquer outro valor (ou nenhum) cai em "perfil"
  const tab: Tab =
    requested === "administracao" && user?.is_admin
      ? "administracao"
      : requested === "aparencia" || requested === "seguranca"
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
        <Tab active={tab === "seguranca"} onSelect={() => chooseTab("seguranca")}>
          {t("common.seguranca")}
        </Tab>
        {user?.is_admin && (
          <Tab active={tab === "administracao"} onSelect={() => chooseTab("administracao")}>
            {t("pages.settings.administracao")}
          </Tab>
        )}
      </TabList>

      {tab === "perfil" && (
        <div className="columns-1 gap-6 xl:columns-2 [&>*]:mb-6 [&>*]:break-inside-avoid">
          <ProfileSection />
          <PasswordSection />
        </div>
      )}

      {tab === "aparencia" && <AppearanceSection />}

      {tab === "seguranca" && <SecuritySection />}

      {tab === "administracao" && user?.is_admin && (
        <div className="columns-1 gap-6 xl:columns-2 [&>*]:mb-6 [&>*]:break-inside-avoid">
          <InvitesSection />
          <SecurityContactSection />
        </div>
      )}
    </>
  );
}
