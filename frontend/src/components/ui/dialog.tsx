import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

// Dialogo centralizado do Radix: prende o foco, fecha com Esc e devolve o foco ao botao que abriu
const Dialog = DialogPrimitive.Root;
const DialogClose = DialogPrimitive.Close;

// As telas abrem os dialogos por estado (um botao muda o estado e o dialogo e montado), nao por um DialogTrigger. Sem o
// trigger o Radix nao sabe a quem devolver o foco e ele cai no <body>: quem usa so o teclado perde o lugar na pagina.
// Por isso guardamos o ultimo elemento focado fora de um dialogo e devolvemos o foco a ele ao fechar.
let lastFocusOutsideDialog: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && !target.closest('[role="dialog"], [role="alertdialog"]')) {
      lastFocusOutsideDialog = target;
    }
  });
}

// fullOnMobile: em tela pequena a janela ocupa a tela toda e os botoes do DialogFooter ficam fixos no rodape. E para as
// janelas com formulario longo (o botao Salvar ficaria no fim de uma rolagem comprida). Do tamanho sm para cima nada muda.
function DialogContent({
  className,
  children,
  onCloseAutoFocus,
  fullOnMobile = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { fullOnMobile?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <DialogPrimitive.Content
        data-full-mobile={fullOnMobile ? "" : undefined}
        className={cn(
          "group/dialog fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto overflow-x-hidden rounded-lg border bg-card p-6 text-card-foreground shadow-lg focus-visible:outline-none",
          fullOnMobile &&
            "max-sm:left-0 max-sm:top-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0",
          className,
        )}
        {...props}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          const opener = lastFocusOutsideDialog;
          if (opener?.isConnected) {
            event.preventDefault();
            opener.focus();
          }
        }}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 pr-6", className)} {...props} />;
}

// Numa janela fullOnMobile o rodape fica fixo na base da tela, com os botoes lado a lado, e cobre a largura toda
// (os -mx/-mb desfazem o padding da janela)
const FULL_MOBILE_FOOTER =
  "group-data-[full-mobile]/dialog:max-sm:sticky group-data-[full-mobile]/dialog:max-sm:bottom-0 group-data-[full-mobile]/dialog:max-sm:z-10 group-data-[full-mobile]/dialog:max-sm:-mx-6 group-data-[full-mobile]/dialog:max-sm:-mb-6 group-data-[full-mobile]/dialog:max-sm:flex-row group-data-[full-mobile]/dialog:max-sm:border-t group-data-[full-mobile]/dialog:max-sm:bg-card group-data-[full-mobile]/dialog:max-sm:px-6 group-data-[full-mobile]/dialog:max-sm:py-3 group-data-[full-mobile]/dialog:max-sm:[&>*]:flex-1";

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", FULL_MOBILE_FOOTER, className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold leading-none", className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
