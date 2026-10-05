import { useAuth } from "@/auth/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { AppearanceSection } from "@/features/settings/appearance-section";
import { InvitesSection } from "@/features/settings/invites-section";
import { PasswordSection } from "@/features/settings/password-section";
import { ProfileSection } from "@/features/settings/profile-section";
import { SecuritySection } from "@/features/settings/security-section";

export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Configurações" description="Seu perfil, senha, aparência e, para o administrador, os convites" />
      {/* Colunas que se enchem de cima para baixo, cada bloco do proprio tamanho (sem buraco ao lado do bloco curto) */}
      <div className="columns-1 gap-6 xl:columns-2 [&>*]:mb-6 [&>*]:break-inside-avoid">
        <ProfileSection />
        <PasswordSection />
        <AppearanceSection />
        <SecuritySection />
        {user?.is_admin && <InvitesSection />}
      </div>
    </>
  );
}
