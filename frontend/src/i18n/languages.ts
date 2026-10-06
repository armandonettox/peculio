// Idiomas do app e as regras de escolha, sem tela e sem biblioteca: ficam aqui, com testes, e o resto so as usa.
// O portugues do Brasil e o idioma de origem dos textos; o ingles e o americano tambem na formatacao.

export const LANGUAGES = ["pt-BR", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "pt-BR";
export const LANGUAGE_STORAGE_KEY = "peculio-language";

/** O nome de cada idioma na lingua dele (nunca traduzido: quem nao le o idioma atual precisa achar o seu). */
export const LANGUAGE_NAMES: Record<Language, string> = {
  "pt-BR": "Português (Brasil)",
  en: "English",
};

/** Idioma do JavaScript Intl (datas, numeros, plurais) para cada idioma do app. */
export function intlLocale(language: Language): string {
  return language === "pt-BR" ? "pt-BR" : "en-US";
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** "pt", "pt-PT" e "PT-br" viram pt-BR; "en", "en-GB" viram en; qualquer outra coisa nao e do app (null). */
export function languageFromTag(tag: string | null | undefined): Language | null {
  const primary = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (primary === "pt") return "pt-BR";
  if (primary === "en") return "en";
  return null;
}

/**
 * A escolha da pessoa vence. Sem escolha, vale o primeiro idioma preferido do navegador: portugues vira pt-BR e qualquer
 * outro (frances, japones...) vira ingles, que e o que a maioria le. Sem preferencia nenhuma, o idioma de origem.
 */
export function detectLanguage(stored: string | null, preferred: readonly string[]): Language {
  if (isLanguage(stored)) return stored;
  const first = preferred.find((tag) => tag && tag.trim());
  if (!first) return DEFAULT_LANGUAGE;
  return languageFromTag(first) ?? "en";
}

export function readStoredLanguage(): string | null {
  // O localStorage pode lancar erro (janela privada, dados do site bloqueados)
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // nao salvar nao impede de trocar o idioma nesta sessao
  }
}
