import { useCallback, useState } from "react";

// O olho do topo esconde os valores do painel (para abrir o app perto de outras pessoas). A escolha fica so neste
// navegador, como as outras preferencias de tela.
const STORAGE_KEY = "peculio.dashboard.hide-values";

export const HIDDEN_VALUE = "••••••";

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useHideValues(): { hidden: boolean; toggle: () => void } {
  const [hidden, setHidden] = useState(read);

  const toggle = useCallback(() => {
    setHidden((current) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, current ? "0" : "1");
      } catch {
        // Sem armazenamento: a escolha vale so ate fechar a pagina
      }
      return !current;
    });
  }, []);

  return { hidden, toggle };
}
