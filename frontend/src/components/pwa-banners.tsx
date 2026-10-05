import { WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/pwa/online";
import { usePwaUpdate } from "@/pwa/update";

/**
 * Os avisos do app instalado, no pe da tela (sobre o conteudo, sem empurrar nada): "Sem conexao" enquanto o aparelho
 * esta sem rede, e "Nova versao disponivel" com o botao Atualizar. Nenhum dos dois aparece em uso normal.
 */
export function PwaBanners() {
  const online = useOnlineStatus();
  const { updateReady, applyUpdate } = usePwaUpdate();
  if (online && !updateReady) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-3">
      {!online && (
        <p role="status" className="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>Sem conexão. O app precisa do servidor para mostrar e salvar seus dados; nada fica guardado no aparelho.</span>
        </p>
      )}
      {updateReady && (
        <div role="status" className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg">
          <span>Nova versão disponível.</span>
          <Button size="sm" onClick={applyUpdate}>
            Atualizar
          </Button>
        </div>
      )}
    </div>
  );
}
