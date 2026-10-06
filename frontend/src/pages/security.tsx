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
import { Trans, useTranslation } from "react-i18next";

// Abaixo disso o aviso de "poucos codigos" aparece
const LOW_CODES = 3;

export default function SecurityPage() {
  const { t } = useTranslation();
  const status = useTwoFactorStatus();
  const contact = useSecurityContact().data?.contact;
  const [dialog, setDialog] = useState<"enable" | ConfirmMode | null>(null);

  let body;
  if (status.isPending) {
    body = (
      <div aria-busy="true" className="h-24 animate-pulse rounded-md border bg-muted">
        <p className="sr-only" role="status">
          {t("common.carregando")}
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
          {t("common.tentarDeNovo")}
        </Button>
      </div>
    );
  } else if (!status.data.enabled) {
    body = (
      <div className="flex flex-col items-start gap-4">
        <p className="flex items-center gap-2 text-sm">
          <ShieldOff className="size-4 text-muted-foreground" />
          {t("pages.security.desativada")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("pages.security.comAVerificacaoEm")}
        </p>
        <Button onClick={() => setDialog("enable")}>{t("pages.security.ativarVerificacaoEmDuas")}</Button>
      </div>
    );
  } else {
    const remaining = status.data.recovery_codes_remaining;
    body = (
      <div className="flex flex-col items-start gap-4">
        <p className="flex items-center gap-2 text-sm font-medium text-positive">
          <ShieldCheck className="size-4" />
          {t("pages.security.ativada")}
        </p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <KeyRound className="size-4" />
          {remaining} {remaining === 1 ? t("pages.security.codigoDeRecuperacaoRestante") : t("pages.security.codigosDeRecuperacaoRestantes")}
        </p>
        {remaining < LOW_CODES && (
          <Alert variant="destructive" className="w-full">
            {remaining === 0
              ? t("pages.security.voceNaoTemMais")
              : t("pages.security.restamPoucosCodigosDe")}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog("regenerate")}>
            {t("pages.security.gerarNovosCodigos")}
          </Button>
          <Button variant="outline" className="text-destructive" onClick={() => setDialog("disable")}>
            {t("pages.security.desativar")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title={t("common.seguranca")} description={t("pages.security.protejaOAcessoA")} />

      {contact && (
        <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
          <Trans
            i18nKey="pages.security.paraRelatarUmProblema"
            values={{ contact }}
            components={{
              wk: <a className="font-medium text-foreground underline" href={securityContactHref(contact)} rel="noopener noreferrer" />,
            }}
          />
        </p>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle as="h2">{t("pages.security.verificacaoEmDuasEtapas")}</CardTitle>
          <CardDescription>{t("pages.security.umSegundoCodigoAlem")}</CardDescription>
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
