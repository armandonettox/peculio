import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { eventLabel, httpText, lastDeliveryText, statusLabel } from "./presentation";

// A logica de webhooks no idioma ingles: rotulos de evento e situacao, e os textos de entrega.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("rotulos", () => {
  it("evento e situacao em ingles", () => {
    expect(eventLabel("transaction.created")).toBe("Transaction created");
    expect(eventLabel("webhook.test")).toBe("Test");
    expect(statusLabel("delivered")).toBe("Delivered");
  });
});

describe("textos de entrega", () => {
  it("ainda nao tentada, http e sem resposta", () => {
    expect(httpText({ attempts: 0, last_status_code: null })).toBe("Not attempted yet");
    expect(httpText({ attempts: 1, last_status_code: 500 })).toBe("HTTP 500");
    expect(httpText({ attempts: 1, last_status_code: null })).toBe("No response");
  });

  it("ultima entrega ou nenhuma ainda", () => {
    expect(lastDeliveryText(null, null)).toBe("No deliveries yet");
    expect(lastDeliveryText("delivered", "2026-03-10T12:00:00Z")).toContain("Last delivery: Delivered on");
  });
});

describe("o mesmo codigo em portugues", () => {
  it("volta aos textos brasileiros", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(eventLabel("transaction.created")).toBe("Lançamento criado");
    expect(httpText({ attempts: 0, last_status_code: null })).toBe("Ainda não tentada");
  });
});
