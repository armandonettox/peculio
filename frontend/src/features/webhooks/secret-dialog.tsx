import { Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trans, useTranslation } from "react-i18next";

type Props = {
  webhookName: string;
  secret: string;
  onDone: () => void;
};

/**
 * Mostra o segredo uma unica vez. So fecha depois de marcar que guardou: o servidor guarda o segredo
 * cifrado e nao o mostra de novo (para ter outro, e preciso girar o segredo).
 */
export function SecretDialog({ webhookName, secret, onDone }: Props) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }

  return (
    // Sem fechar por Esc, clique fora ou no X: so o botao Concluir, depois de marcar a caixa
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("webhooks.secretDialog.segredoDoWebhook")}</DialogTitle>
          <DialogDescription>
            <Trans
              i18nKey="webhooks.secretDialog.guardeOSegredoDe"
              values={{ name: webhookName }}
              components={{ strong: <strong /> }}
            />
          </DialogDescription>
        </DialogHeader>

        <code
          aria-label={t("webhooks.secretDialog.segredo")}
          className="break-all rounded-md border bg-muted p-3 font-mono text-sm"
          data-testid="webhook-secret"
        >
          {secret}
        </code>

        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
            <Copy />
            {t("webhooks.secretDialog.copiar")}
          </Button>
          <p role="status" className="text-xs text-muted-foreground">
            {copied === "ok" && t("webhooks.secretDialog.segredoCopiado")}
            {copied === "fail" && t("webhooks.secretDialog.naoFoiPossivelCopiar")}
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
            className="mt-0.5 accent-[var(--primary)]"
          />
          {t("webhooks.secretDialog.guardeiOSegredo")}
        </label>

        <DialogFooter>
          <Button type="button" onClick={onDone} disabled={!saved}>
            {t("common.concluir")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
