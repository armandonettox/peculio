// Como a pagina de transacoes mostra os lancamentos: em lista de cartoes ou em tabela. A escolha fica lembrada neste
// navegador (so uma conveniencia: sem armazenamento disponivel, vale a lista).

export type ViewMode = "list" | "table";

const STORAGE_KEY = "peculio:transactions-view";

export function parseViewMode(value: string | null): ViewMode {
  return value === "table" ? "table" : "list";
}

export function readViewMode(): ViewMode {
  try {
    return parseViewMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "list";
  }
}

export function saveViewMode(mode: ViewMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Sem armazenamento (janela privada, dados bloqueados): a escolha vale so ate fechar a pagina
  }
}
