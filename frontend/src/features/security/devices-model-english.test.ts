import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { devicesText, lastUsedLabel } from "./devices-model";

const NOW = new Date("2026-03-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Os aparelhos conectados no idioma ingles: ha quanto tempo foi usado e a contagem.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

it("ha quanto tempo em ingles", () => {
  expect(lastUsedLabel(ago(0), NOW)).toBe("now");
  expect(lastUsedLabel(ago(5 * MIN), NOW)).toBe("5 min ago");
  expect(lastUsedLabel(ago(3 * HOUR), NOW)).toBe("3 h ago");
  expect(lastUsedLabel(ago(DAY), NOW)).toBe("1 day ago");
  expect(lastUsedLabel(ago(12 * DAY), NOW)).toBe("12 days ago");
});

it("contagem de aparelhos no singular, plural e zero", () => {
  expect(devicesText(0)).toBe("0 devices");
  expect(devicesText(1)).toBe("1 device");
  expect(devicesText(3)).toBe("3 devices");
});

it("volta aos textos brasileiros", async () => {
  await i18n.changeLanguage("pt-BR");
  expect(lastUsedLabel(ago(0), NOW)).toBe("agora");
  expect(devicesText(1)).toBe("1 aparelho");
});
