import { useSyncExternalStore } from "react";

// Se o aparelho tem rede. O navegador so sabe dizer "sem rede nenhuma" com certeza; "com rede" pode ser uma rede que nao
// chega ao servidor. Por isso o aviso e so sobre o que e certo, e as telas continuam mostrando os erros de conexao delas.

function subscribe(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function useOnlineStatus(): boolean {
  // No servidor (sem navigator) considera online
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
