import type { WebhookDelivery } from "@/api/webhooks";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { httpText } from "./presentation";
import { Trans, useTranslation } from "react-i18next";

type Props = {
  webhookName: string;
  // Sem resultado nem erro: o teste ainda esta sendo enviado
  result: WebhookDelivery | null;
  error: string | null;
  onClose: () => void;
};

export function TestResultDialog({ webhookName, result, error, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("webhooks.testResultDialog.testeDoWebhook")}</DialogTitle>
          <DialogDescription>
            <Trans
              i18nKey="webhooks.testResultDialog.avisoDeTeste"
              values={{ name: webhookName }}
              components={{ strong: <strong /> }}
            />
          </DialogDescription>
        </DialogHeader>

        {!result && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("webhooks.testResultDialog.enviandoOTeste")}
          </p>
        )}

        {error && <Alert variant="destructive">{error}</Alert>}

        {result && (
          <div className="flex flex-col gap-2">
            {result.status === "delivered" ? (
              <Alert>{t("webhooks.testResultDialog.entregueComSucesso", { http: httpText(result) })}</Alert>
            ) : (
              <Alert variant="destructive">
                {result.last_error
                  ? t("webhooks.testResultDialog.naoFoiEntregueComErro", { http: httpText(result), error: result.last_error })
                  : t("webhooks.testResultDialog.naoFoiEntregue", { http: httpText(result) })}
              </Alert>
            )}
            {result.response_excerpt && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">{t("webhooks.testResultDialog.respostaDoEndereco")}</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted p-2 text-xs">
                  {result.response_excerpt}
                </pre>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>{t("common.fechar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
