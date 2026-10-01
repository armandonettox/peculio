// Caminhos de autenticacao nao servem de destino (levariam de volta ao login em loop)
const AUTH_PATHS = ["/login", "/register"];

/**
 * Valida o parametro ?next= antes de redirecionar. Aceita so caminho interno do app.
 * Sem isso, um link como /login?next=//site-malicioso.com levaria o usuario para fora
 * logo depois de entrar (open redirect).
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  // Precisa ser caminho absoluto interno. "//host" e "/\host" o navegador trata como outro site.
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  // Caracteres de controle (quebra de linha, tab) podem esconder um destino diferente
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, "http://internal.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://internal.invalid") return fallback;
  if (AUTH_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) {
    return fallback;
  }

  // O URL resolve "/.." e "%2F" antes de devolver o caminho: "/x/../..//evil.com" vira
  // "//evil.com", que o navegador trata como outro site. Por isso confere de novo o
  // resultado, nao so a entrada.
  const normalized = `${url.pathname}${url.search}${url.hash}`;
  if (normalized.startsWith("//") || normalized.includes("\\")) return fallback;
  return normalized;
}
