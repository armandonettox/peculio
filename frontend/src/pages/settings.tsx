import { useSearchParams } from "react-router-dom";

import { useAuth } from "@/auth/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
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

      <div role="group" aria-label={t("pages.settings.secaoDeConfiguracoes")} className="mb-6 flex flex-wrap gap-1">
        <Button size="sm" variant={tab === "perfil" ? "default" : "outline"} aria-pressed={tab === "perfil"} onClick={() => chooseTab("perfil")}>
          {t("pages.settings.perfil")}
        </Button>
        <Button
          size="sm"
          variant={tab === "aparencia" ? "default" : "outline"}
          aria-pressed={tab === "aparencia"}
          onClick={() => chooseTab("aparencia")}
        >
          {t("pages.settings.aparencia")}
        </Button>
        <Button
          size="sm"
          variant={tab === "seguranca" ? "default" : "outline"}
          aria-pressed={tab === "seguranca"}
          onClick={() => chooseTab("seguranca")}
        >
          {t("common.seguranca")}
        </Button>
        {user?.is_admin && (
          <Button
            size="sm"
            variant={tab === "administracao" ? "default" : "outline"}
            aria-pressed={tab === "administracao"}
            onClick={() => chooseTab("administracao")}
          >
            {t("pages.settings.administracao")}
          </Button>
        )}
      </div>

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
