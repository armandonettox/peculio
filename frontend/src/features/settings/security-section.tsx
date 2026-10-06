import { ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";

/** Atalho para a pagina de Seguranca, que tem a verificacao em duas etapas e os tokens de API. */
export function SecuritySection() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("common.seguranca")}</CardTitle>
        <CardDescription>{t("settings.securitySection.verificacaoEmDuasEtapas")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link to="/seguranca">
            <ShieldCheck />
            {t("settings.securitySection.abrirAPaginaDe")}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
