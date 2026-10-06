import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { entriesText, statusLabel } from "./preview-model";

// A pre-visualizacao de importacao no idioma ingles: situacao da linha e o plural de lancamentos.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

it("situacao da linha em ingles", () => {
  expect(statusLabel({ status: "error", duplicate_kind: null })).toBe("Error");
  expect(statusLabel({ status: "new", duplicate_kind: null })).toBe("New");
  expect(statusLabel({ status: "duplicate", duplicate_kind: "same_id" })).toBe("Already imported");
  expect(statusLabel({ status: "duplicate", duplicate_kind: "similar" })).toBe("Looks duplicated");
});

it("contagem no singular, plural e zero", () => {
  expect(entriesText(0)).toBe("0 transactions");
  expect(entriesText(1)).toBe("1 transaction");
  expect(entriesText(3)).toBe("3 transactions");
});

it("volta aos textos brasileiros", async () => {
  await i18n.changeLanguage("pt-BR");
  expect(statusLabel({ status: "error", duplicate_kind: null })).toBe("Erro");
  expect(entriesText(0)).toBe("0 lançamentos");
});
