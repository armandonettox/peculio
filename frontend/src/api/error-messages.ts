import { i18n } from "@/i18n";
import { ApiError } from "./errors";

// A mensagem de cada codigo de erro do backend (app/core/errors.py, ErrorCode) fica em src/i18n/locales, em errors.<codigo>,
// nos dois idiomas. Um teste confere que todo codigo do backend tem mensagem.
const key = (code: string) => `errors.${code}`;

/** O codigo tem mensagem traduzida? ("fallback" e a mensagem generica, nao um codigo.) */
export function hasErrorMessage(code: string): boolean {
  return code !== "fallback" && i18n.exists(key(code));
}

// Mensagem para mostrar ao usuario, no idioma em uso. Codigo desconhecido cai no texto do servidor.
export function getErrorMessage(error: unknown): string {
  const fallback = i18n.t("errors.fallback");
  if (error instanceof ApiError) {
    if (hasErrorMessage(error.code)) return i18n.t(key(error.code) as "errors.fallback");
    return error.message ?? fallback;
  }
  return fallback;
}
