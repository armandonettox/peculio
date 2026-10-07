// As regras do service worker, sem navegador: o que ele guarda, o que nunca toca e como os caches se chamam. Ficam aqui,
// com testes em tabela, e o worker so as aplica.
//
// O service worker guarda SO a casca do app (a pagina, os scripts, estilos e icones do mesmo endereco). Nunca guarda a
// API nem nenhuma resposta de dados: dado financeiro nao fica no aparelho.

export type RequestInfo = { url: string; method: string; mode: string };

/** ignore: o worker nao mexe (vai direto para a rede). navigate: abrir uma pagina. static: arquivo da casca. */
export type Strategy = "ignore" | "navigate" | "static";

export const CACHE_PREFIX = "peculio-shell-";

// A pagina que serve de casca para qualquer rota do app (o React Router decide o resto)
export const SHELL_URL = "/";

export const cacheNameFor = (buildId: string) => `${CACHE_PREFIX}${buildId}`;

/** Os caches de versoes antigas do app, para apagar. Cache de outro assunto (outro app no mesmo endereco) nao e tocado. */
export function staleCaches(names: readonly string[], current: string): string[] {
  return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current);
}

const STATIC_PREFIXES = ["/assets/", "/icons/"];
const STATIC_FILES = ["/manifest.webmanifest", "/favicon.svg", "/theme-init.js"];

export function isStaticPath(pathname: string): boolean {
  return STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || STATIC_FILES.includes(pathname);
}

/** A API nunca passa pelo cache. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function classifyRequest(request: RequestInfo, origin: string): Strategy {
  // So leitura: gravar (POST, PUT, DELETE...) nunca e do cache
  if (request.method !== "GET") return "ignore";
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return "ignore";
  }
  // Outro endereco (fonte, imagem, API de terceiro) nao e da casca
  if (url.origin !== origin) return "ignore";
  if (isApiPath(url.pathname)) return "ignore";
  // O proprio service worker precisa vir sempre da rede, senao nunca se atualiza
  if (url.pathname === "/sw.js") return "ignore";
  if (request.mode === "navigate") return "navigate";
  return isStaticPath(url.pathname) ? "static" : "ignore";
}

/** So resposta inteira e do mesmo endereco vale guardar: erro, redirecionamento e resposta opaca ficam de fora. */
export function isCacheable(response: { status: number; type: string }): boolean {
  return response.status === 200 && (response.type === "basic" || response.type === "default");
}

/**
 * Os arquivos que a pagina pede ao carregar (scripts, estilos, icones, manifesto), lidos do proprio HTML. Assim o
 * worker guarda a casca inteira ao instalar, sem precisar de uma lista gerada na hora do build.
 */
export function shellAssetsFromHtml(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)="(\/[^"#?]*)"/g)) {
    if (isStaticPath(match[1])) found.add(match[1]);
  }
  return [...found];
}

// Pagina minima para quando nao ha nem a casca guardada (cache apagado pelo navegador) e a rede caiu. O worker nao
// enxerga o idioma escolhido na tela (fica no localStorage da pagina, que o worker nao le): usa o Accept-Language da
// propria requisicao de navegacao, a mesma pista que o servidor usa, e a mesma regra de "so portugues ou ingles".

type OfflineLanguage = "pt-BR" | "en";

const OFFLINE_TEXT: Record<OfflineLanguage, { title: string; body: string; button: string }> = {
  "pt-BR": {
    title: "Sem conexão",
    body: "O Pecúlio precisa do servidor para mostrar seus dados. Confira a internet e tente de novo.",
    button: "Tentar de novo",
  },
  en: {
    title: "No connection",
    body: "Pecúlio needs the server to show your data. Check your connection and try again.",
    button: "Try again",
  },
};

function offlineHtml(language: OfflineLanguage): string {
  const text = OFFLINE_TEXT[language];
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text.title}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8f9fa;color:#171717;text-align:center;padding:24px}
button{margin-top:16px;padding:8px 16px;border:0;border-radius:6px;background:#1e3a6b;color:#fff;font-size:16px}</style></head>
<body><main><h1>${text.title}</h1><p>${text.body}</p>
<button onclick="location.reload()">${text.button}</button></main></body></html>`;
}

// O primeiro idioma preferido do cabecalho ("pt-BR,en;q=0.9" -> "pt-BR"), sem o peso (q=...)
function firstAcceptLanguage(header: string | null): string | null {
  const first = (header ?? "").split(",")[0]?.split(";")[0]?.trim();
  return first || null;
}

/** pt-BR (de qualquer pais) fica em portugues; qualquer outro idioma, em ingles; sem cabecalho, o idioma de origem. */
function languageFromAcceptHeader(header: string | null): OfflineLanguage {
  const tag = firstAcceptLanguage(header);
  if (!tag) return "pt-BR";
  return tag.toLowerCase().split(/[-_]/)[0] === "pt" ? "pt-BR" : "en";
}

// Mantido por compatibilidade (testes antigos, e o caso sem cabecalho nenhum): a pagina em portugues, o idioma de origem
export const OFFLINE_HTML = offlineHtml("pt-BR");

/** A pagina de sem conexao no idioma do Accept-Language da requisicao que falhou. */
export function offlineHtmlFor(acceptLanguage: string | null): string {
  return offlineHtml(languageFromAcceptHeader(acceptLanguage));
}
