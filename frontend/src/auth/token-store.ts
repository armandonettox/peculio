// O token de acesso vive so em memoria. Nao vai para localStorage nem sessionStorage:
// assim um script injetado na pagina (XSS) nao consegue le-lo. O custo e que recarregar a
// pagina pede novo login (ver a nota do plano: da para trocar por cookie HttpOnly na Fase 6).

export type TokenStore = {
  get: () => string | null;
  set: (token: string) => void;
  clear: () => void;
  // Avisa quando o token muda (inclusive quando a renovacao falha e ele e limpo)
  subscribe: (listener: (token: string | null) => void) => () => void;
};

export function createTokenStore(): TokenStore {
  let token: string | null = null;
  const listeners = new Set<(token: string | null) => void>();

  const notify = () => listeners.forEach((listener) => listener(token));

  return {
    get: () => token,
    set: (next) => {
      token = next;
      notify();
    },
    clear: () => {
      if (token === null) return;
      token = null;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const tokenStore = createTokenStore();
