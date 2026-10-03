import type { ReactNode } from "react";

import { useAppClock } from "@/api/clock";

/**
 * Segura a tela por um instante, so ate o relogio do servidor chegar, para a primeira renderizacao ja
 * usar o dia certo. Se o pedido falhar, mostra a tela mesmo assim (com o relogio do aparelho).
 */
export function AppClockGate({ children }: { children: ReactNode }) {
  const clock = useAppClock();
  if (clock.isPending) {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted-foreground">
        Carregando...
      </p>
    );
  }
  return <>{children}</>;
}
