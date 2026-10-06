import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { dimensions } from "./presentation";

// As dimensoes de relatorio no idioma ingles: titulo, coluna, texto sem valor e a nota da tag.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

it("quatro dimensoes com titulo, coluna e fallback em ingles; so a tag tem nota", () => {
  const list = dimensions();
  expect(list.map((item) => item.key)).toEqual(["category", "tag", "budget", "account"]);
  expect(list.find((item) => item.key === "category")).toMatchObject({ title: "By category", column: "Category", fallback: "No category" });
  expect(list.find((item) => item.key === "tag")?.note).toMatch(/exceed the total/);
  expect(list.find((item) => item.key === "account")?.note).toBeUndefined();
});

it("volta aos textos brasileiros", async () => {
  await i18n.changeLanguage("pt-BR");
  expect(dimensions()[0].title).toBe("Por categoria");
});
