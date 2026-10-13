import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  // fixed: o app cria o lancamento sozinho; varies: o app so lembra o vencimento
  onPick: (kind: "fixed" | "varies") => void;
  onClose: () => void;
};

/** Primeiro passo de "Nova recorrente": a pessoa responde se o valor muda, e o app escolhe o formulario certo. */
export function RecurrenceKindDialog({ onPick, onClose }: Props) {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.recurrences.novaRecorrente")}</DialogTitle>
          <DialogDescription>{t("pages.recurrences.oValorESempre")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-auto flex-col items-start gap-1 whitespace-normal py-3 text-left"
            onClick={() => onPick("fixed")}
          >
            <span className="font-semibold">{t("pages.recurrences.valorFixo")}</span>
            <span className="text-sm font-normal text-muted-foreground">{t("pages.recurrences.valorFixoDescricao")}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto flex-col items-start gap-1 whitespace-normal py-3 text-left"
            onClick={() => onPick("varies")}
          >
            <span className="font-semibold">{t("pages.recurrences.valorVaria")}</span>
            <span className="text-sm font-normal text-muted-foreground">{t("pages.recurrences.valorVariaDescricao")}</span>
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancelar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
