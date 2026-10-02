const MASK = "***";
const INVALID_TEXT = "Endereço inválido";

/**
 * Versão do endereço do webhook que pode aparecer na tela da lista.
 *
 * Mostra esquema, host (com a porta, se tiver) e caminho. A query string, o fragmento (#...) e as
 * credenciais (usuário:senha@) viram "***", porque é ali que costuma ir o token. A API continua
 * devolvendo o endereço inteiro: na edição o campo mostra o valor real para a pessoa poder corrigir.
 * Se o texto não for um endereço http(s) legível, nada dele é exibido.
 */
export function maskWebhookUrl(raw: string): string {
  let url: URL;
  try {
    // O parser ja ignora espacos nas pontas, e para http(s) nunca aceita host vazio
    url = new URL(raw);
  } catch {
    return INVALID_TEXT;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return INVALID_TEXT;

  const hasCredentials = url.username !== "" || url.password !== "";
  let masked = `${url.protocol}//${hasCredentials ? `${MASK}@` : ""}${url.host}${url.pathname}`;
  if (url.search !== "") masked += `?${MASK}`;
  if (url.hash !== "") masked += `#${MASK}`;
  return masked;
}
