import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shortcutGroups } from "./table-nav";
import { useTranslation } from "react-i18next";

/** As teclas da tabela de lancamentos, para ninguem precisar decorar. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("transactions.shortcutsDialog.atalhosDaTabela")}</DialogTitle>
          <DialogDescription>
            {t("transactions.shortcutsDialog.asTeclasDeUma")}
          </DialogDescription>
        </DialogHeader>

        {shortcutGroups().map((group) => (
          <section key={group.title} aria-label={group.title} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{group.title}</h3>
            <dl className="flex flex-col gap-1.5 text-sm">
              {group.items.map((item) => (
                <div key={item.text} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{item.text}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {item.keys.map((key) => (
                      <kbd key={key} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <DialogFooter>
          <Button onClick={onClose}>{t("common.fechar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
