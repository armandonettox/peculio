import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LANGUAGE,
  detectLanguage,
  intlLocale,
  isLanguage,
  LANGUAGE_NAMES,
  LANGUAGE_STORAGE_KEY,
  LANGUAGES,
  languageFromTag,
  readStoredLanguage,
  saveLanguage,
} from "./languages";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("languageFromTag", () => {
  it.each([
    ["pt", "pt-BR"],
    ["pt-BR", "pt-BR"],
    ["pt-br", "pt-BR"],
    ["PT-PT", "pt-BR"],
    ["pt_BR", "pt-BR"],
    ["en", "en"],
    ["en-US", "en"],
    ["en-GB", "en"],
    ["EN", "en"],
    ["  en-AU ", "en"],
  ])("%s vira %s", (tag, expected) => expect(languageFromTag(tag)).toBe(expected));

  it.each([["fr"], ["ja-JP"], ["es-419"], ["pte"], ["portugues"], [""], ["   "], [null], [undefined]])(
    "%j nao e um idioma do app",
    (tag) => expect(languageFromTag(tag)).toBeNull(),
  );
});

describe("detectLanguage", () => {
  it("a escolha guardada vence o navegador", () => {
    expect(detectLanguage("en", ["pt-BR"])).toBe("en");
    expect(detectLanguage("pt-BR", ["en-US"])).toBe("pt-BR");
  });

  it("escolha guardada invalida (valor velho ou adulterado) e ignorada", () => {
    expect(detectLanguage("fr", ["pt-BR"])).toBe("pt-BR");
    expect(detectLanguage("", ["en-US"])).toBe("en");
    expect(detectLanguage("EN", ["pt-BR"])).toBe("pt-BR");
    expect(detectLanguage("<script>", [])).toBe(DEFAULT_LANGUAGE);
  });

  it.each([
    [["pt-BR", "en"], "pt-BR"],
    [["pt"], "pt-BR"],
    [["en-US", "pt-BR"], "en"],
    [["fr-FR", "pt-BR"], "en"], // o primeiro manda: frances nao e do app, entao vira ingles
    [["ja"], "en"],
    [["", "pt-BR"], "pt-BR"], // vazio nao conta como preferencia
    [["", "en-US"], "en"], // vazio nao conta: vale a proxima preferencia, nao o idioma de origem
    [["  ", "fr", "pt-BR"], "en"],
  ])("sem escolha, o primeiro idioma do navegador %j vira %s", (preferred, expected) => {
    expect(detectLanguage(null, preferred)).toBe(expected);
  });

  it("sem escolha e sem preferencia nenhuma, fica o idioma de origem", () => {
    expect(detectLanguage(null, [])).toBe("pt-BR");
    expect(detectLanguage(null, ["", "  "])).toBe("pt-BR");
  });
});

describe("idiomas", () => {
  it("o idioma de origem e o portugues do Brasil", () => {
    expect(DEFAULT_LANGUAGE).toBe("pt-BR");
    expect(LANGUAGES).toEqual(["pt-BR", "en"]);
  });

  it("isLanguage so aceita exatamente os idiomas do app", () => {
    expect(isLanguage("pt-BR")).toBe(true);
    expect(isLanguage("en")).toBe(true);
    for (const value of ["pt", "en-US", "PT-BR", "", null, undefined, 1, {}]) expect(isLanguage(value)).toBe(false);
  });

  it("cada idioma tem um nome na propria lingua", () => {
    expect(LANGUAGE_NAMES).toEqual({ "pt-BR": "Português (Brasil)", en: "English" });
  });

  it("o ingles formata datas e numeros como americano", () => {
    expect(intlLocale("pt-BR")).toBe("pt-BR");
    expect(intlLocale("en")).toBe("en-US");
    expect(new Intl.NumberFormat(intlLocale("pt-BR")).format(1234.5)).toBe("1.234,5");
    expect(new Intl.NumberFormat(intlLocale("en")).format(1234.5)).toBe("1,234.5");
  });
});

describe("escolha guardada", () => {
  it("guarda e le", () => {
    expect(readStoredLanguage()).toBeNull();
    saveLanguage("en");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(readStoredLanguage()).toBe("en");
  });

  it("sem armazenamento (janela privada), le como vazio e guardar nao quebra", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(readStoredLanguage()).toBeNull();
    expect(() => saveLanguage("en")).not.toThrow();
  });
});
