import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { inviteState, passwordFormErrors, profileErrors, securityContactError } from "./model";

// As regras de configuracoes no idioma ingles: erros de formulario e a situacao do convite.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("erros de formulario", () => {
  it("perfil e senha em ingles", () => {
    expect(profileErrors({ name: "", currency: "BRL" }).name).toBe("Enter the name.");
    expect(profileErrors({ name: "Ana", currency: "" }).currency).toBe("Choose the currency.");
    expect(passwordFormErrors({ current: "", next: "", confirm: "" }).current).toBe("Enter the current password.");
    expect(
      passwordFormErrors({ current: "MesmaSenha1", next: "MesmaSenha1", confirm: "MesmaSenha1" }).next,
    ).toBe("The new password needs to be different from the current one.");
  });

  it("contato de seguranca", () => {
    expect(securityContactError("nada")).toBe("Enter a valid email or an address starting with https://.");
    expect(securityContactError("https://")).toBe("The https:// address isn't valid.");
  });
});

describe("situacao do convite", () => {
  const now = new Date("2026-03-10T12:00:00Z");

  it("usado, vencido e vence em dias", () => {
    expect(inviteState({ used_at: "2026-03-05T10:00:00Z", expires_at: now.toISOString() }, now).label).toBe("Used");
    expect(inviteState({ used_at: null, expires_at: "2026-03-01T00:00:00Z" }, now).label).toBe("Expired");
    expect(inviteState({ used_at: null, expires_at: "2026-03-17T12:00:00Z" }, now).label).toBe("Expires in 7 days");
  });
});

describe("o mesmo codigo em portugues", () => {
  it("volta aos textos brasileiros", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(profileErrors({ name: "", currency: "BRL" }).name).toBe("Informe o nome.");
  });
});
