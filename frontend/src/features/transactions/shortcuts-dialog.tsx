import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUT_GROUPS } from "./table-nav";

/** As teclas da tabela de lancamentos, para ninguem precisar decorar. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atalhos da tabela</DialogTitle>
          <DialogDescription>
            As teclas de uma letra só funcionam com o foco numa linha da tabela; dentro de um campo você digita normalmente. O valor com
            menos na frente é saída e sem sinal é entrada.
          </DialogDescription>
        </DialogHeader>

        {SHORTCUT_GROUPS.map((group) => (
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
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
