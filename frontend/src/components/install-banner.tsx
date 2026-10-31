import { Download, PlusSquare, Share, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInstallPrompt } from "@/pwa/install";
import { detectPlatform, isStandalone, readInstallBannerDismissed, writeInstallBannerDismissed } from "@/pwa/platform";

/**
 * Convite para instalar o app no atalho do celular, no topo do painel. No Android abre o convite do navegador com um
 * toque; no iPhone (onde o navegador nao oferece nada) mostra o passo a passo do menu Compartilhar. Nao aparece no
 * computador, nem com o app ja instalado, nem depois de dispensado.
 */
export function InstallBanner() {
  const { t } = useTranslation();
  const { canInstall, install } = useInstallPrompt();
  const [platform] = useState(() => detectPlatform());
  const [standalone] = useState(() => isStandalone());
  const [dismissed, setDismissed] = useState(() => readInstallBannerDismissed());
  const [stepsOpen, setStepsOpen] = useState(false);

  const available = platform === "ios" || (platform === "android" && canInstall);
  if (standalone || dismissed || !available) return null;

  function dismiss() {
    writeInstallBannerDismissed();
    setDismissed(true);
  }

  return (
    <section aria-label={t("components.installBanner.instalarNoCelular")} className="mb-6 flex items-center gap-3 rounded-lg border bg-card p-4">
      <Smartphone className="size-6 shrink-0 text-primary-text" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm">{t("components.installBanner.textoConvite")}</p>
        <div>
          {platform === "ios" ? (
            <Button size="sm" onClick={() => setStepsOpen(true)}>
              {t("components.installBanner.comoInstalar")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void install()}>
              <Download aria-hidden="true" />
              {t("components.userMenu.instalarApp")}
            </Button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("components.installBanner.dispensar")}
        className="self-start rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden="true" />
      </button>

      <Dialog open={stepsOpen} onOpenChange={setStepsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("components.installBanner.tituloPassos")}</DialogTitle>
            <DialogDescription>{t("components.installBanner.descricaoPassos")}</DialogDescription>
          </DialogHeader>
          <ol className="flex flex-col gap-4 text-sm">
            <li className="flex items-start gap-3">
              <Share className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden="true" />
              <span>{t("components.installBanner.passoCompartilhar")}</span>
            </li>
            <li className="flex items-start gap-3">
              <PlusSquare className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden="true" />
              <span>{t("components.installBanner.passoAdicionar")}</span>
            </li>
            <li className="flex items-start gap-3">
              <Smartphone className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden="true" />
              <span>{t("components.installBanner.passoConfirmar")}</span>
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">{t("components.installBanner.avisoSafari")}</p>
        </DialogContent>
      </Dialog>
    </section>
  );
}
