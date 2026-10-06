import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { DEFAULT_LANGUAGE, intlLocale, saveLanguage, type Language } from "./languages";
import en from "./locales/en.json";
import ptBR from "./locales/pt-BR.json";

// Tipos das chaves: o portugues (idioma de origem) e a referencia. t("chave.que.nao.existe") nao compila, e o teste de
// paridade garante que o ingles tem as mesmas chaves.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof ptBR };
  }
}

export const resources = {
  "pt-BR": { translation: ptBR },
  en: { translation: en },
} as const;

/** Liga o i18next no idioma dado. Chamar uma vez, antes de montar o React (e nos testes, no setup). */
export function initI18n(language: Language) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false }, // o React ja escapa
    returnNull: false,
  });
  document.documentElement.lang = language;
  return i18n;
}

/** O idioma em uso agora, ja como Language. */
export function currentLanguage(): Language {
  return i18n.language === "en" ? "en" : "pt-BR";
}

/** O locale do Intl para o idioma em uso (datas, numeros). */
export function currentIntlLocale(): string {
  return intlLocale(currentLanguage());
}

/** Troca o idioma, guarda a escolha neste navegador e avisa o resto da pagina (leitor de tela, datas). */
export async function changeLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  saveLanguage(language);
  document.documentElement.lang = language;
}

export { default as i18n } from "i18next";
