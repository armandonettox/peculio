import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Moldura de uma tabela que pode rolar (no celular, uma tabela larga passa da tela). Quem usa so o teclado precisa
 * conseguir focar a area para rolar com as setas: por isso ela recebe foco e um nome. Use em tabelas que so tem texto;
 * onde ja ha botao, link ou caixa dentro, o foco desses elementos ja resolve.
 */
export function TableScroll({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      className={cn(
        "relative overflow-x-auto rounded-lg border bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </div>
  );
}
