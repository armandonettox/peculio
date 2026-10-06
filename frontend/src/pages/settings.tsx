import { useAuth } from "@/auth/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { AppearanceSection } from "@/features/settings/appearance-section";
import { InvitesSection } from "@/features/settings/invites-section";
import { PasswordSection } from "@/features/settings/password-section";
import { ProfileSection } from "@/features/settings/profile-section";
import { SecurityContactSection } from "@/features/settings/security-contact-section";
import { SecuritySection } from "@/features/settings/security-section";
import { useTranslation } from "react-i18next";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <>
      <PageHeader title={t("pages.settings.configuracoes")} description={t("pages.settings.seuPerfilSenhaAparencia")} />
      {/* Colunas que se enchem de cima para baixo, cada bloco do proprio tamanho (sem buraco ao lado do bloco curto) */}
      <div className="columns-1 gap-6 xl:columns-2 [&>*]:mb-6 [&>*]:break-inside-avoid">
        <ProfileSection />
        <PasswordSection />
        <AppearanceSection />
        <SecuritySection />
        {user?.is_admin && <InvitesSection />}
        {user?.is_admin && <SecurityContactSection />}
      </div>
    </>
  );
}
