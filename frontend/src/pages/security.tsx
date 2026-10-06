import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { useSecurityContact } from "@/api/instance";
import { useTwoFactorStatus } from "@/api/two-factor";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiTokensSection } from "@/features/api-tokens/api-tokens-section";
import { ConfirmTwoFactorDialog, type ConfirmMode } from "@/features/security/confirm-two-factor-dialog";
import { DevicesSection } from "@/features/security/devices-section";
import { EnableTwoFactorDialog } from "@/features/security/enable-two-factor-dialog";
import { securityContactHref } from "@/features/settings/model";

// Abaixo disso o aviso de "poucos codigos" aparece
const LOW_CODES = 3;

export default function SecurityPage() {
  const status = useTwoFactorStatus();
  const contact = useSecurityContact().data?.contact;
  const [dialog, setDialog] = useState<"enable" | ConfirmMode | null>(null);

  let body;
  if (status.isPending) {
    body = (
      <div aria-busy="true" className="h-24 animate-pulse rounded-md border bg-muted">
        <p className="sr-only" role="status">
          Carregando...
        </p>
      </div>
    );
  } else if (status.isError) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(status.error)}
        </Alert>
        <Button variant="outline" onClick={() => void status.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  } else if (!status.data.enabled) {
    body = (
      <div className="flex flex-col items-start gap-4">
        <p className="flex items-center gap-2 text-sm">
          <ShieldOff className="size-4 text-muted-foreground" />
          Desativada
        </p>
        <p className="text-sm text-muted-foreground">
          Com a verificação em duas etapas, além da senha você digita um código do seu celular. Mesmo que alguém
          descubra sua senha, não consegue entrar.
        </p>
        <Button onClick={() => setDialog("enable")}>Ativar verificação em duas etapas</Button>
      </div>
    );
  } else {
    const remaining = status.data.recovery_codes_remaining;
    body = (
      <div className="flex flex-col items-start gap-4">
        <p className="flex items-center gap-2 text-sm font-medium text-positive">
          <ShieldCheck className="size-4" />
          Ativada
        </p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <KeyRound className="size-4" />
          {remaining} {remaining === 1 ? "código de recuperação restante" : "códigos de recuperação restantes"}
        </p>
        {remaining < LOW_CODES && (
          <Alert variant="destructive" className="w-full">
            {remaining === 0
              ? "Você não tem mais códigos de recuperação. Gere novos para não ficar sem acesso se perder o celular."
              : "Restam poucos códigos de recuperação. Gere novos para não ficar sem acesso se perder o celular."}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog("regenerate")}>
            Gerar novos códigos
          </Button>
          <Button variant="outline" className="text-destructive" onClick={() => setDialog("disable")}>
            Desativar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Segurança" description="Proteja o acesso à sua conta" />

      {contact && (
        <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
          Para relatar um problema de segurança nesta instalação, fale com{" "}
          <a className="font-medium text-foreground underline" href={securityContactHref(contact)} rel="noopener noreferrer">
            {contact}
          </a>
          .
        </p>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Verificação em duas etapas</CardTitle>
          <CardDescription>Um segundo código, além da senha, ao entrar.</CardDescription>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>

      <DevicesSection />

      <ApiTokensSection />

      {dialog === "enable" && <EnableTwoFactorDialog onClose={() => setDialog(null)} />}
      {(dialog === "disable" || dialog === "regenerate") && (
        <ConfirmTwoFactorDialog mode={dialog} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
