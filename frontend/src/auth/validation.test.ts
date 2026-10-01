import { describe, expect, it } from "vitest";

import { emailError, passwordError, requiredError } from "./validation";

describe("emailError", () => {
  it.each(["ana@example.com", " ana@example.com ", "a.b+c@sub.example.com.br"])("aceita %j", (email) => {
    expect(emailError(email)).toBeUndefined();
  });

  it.each(["", "   ", "ana", "ana@", "@example.com", "ana@example", "ana @example.com", "a@@example.com"])(
    "recusa %j",
    (email) => {
      expect(emailError(email)).toBeTruthy();
    },
  );

  it("pede o e-mail quando esta vazio", () => {
    expect(emailError("")).toBe("Informe o e-mail.");
  });
});

describe("passwordError", () => {
  it("aceita de 8 a 72 bytes", () => {
    expect(passwordError("12345678")).toBeUndefined();
    expect(passwordError("a".repeat(72))).toBeUndefined();
  });

  it("recusa menos de 8 caracteres", () => {
    expect(passwordError("1234567")).toContain("pelo menos 8");
  });

  it("recusa mais de 72 bytes", () => {
    expect(passwordError("a".repeat(73))).toContain("72 bytes");
  });

  it("conta bytes, nao caracteres (acentos ocupam 2 bytes)", () => {
    expect(passwordError("é".repeat(36))).toBeUndefined();
    expect(passwordError("é".repeat(37))).toContain("72 bytes");
  });
});

describe("requiredError", () => {
  it("recusa vazio e so espacos", () => {
    expect(requiredError("", "Obrigatório")).toBe("Obrigatório");
    expect(requiredError("   ", "Obrigatório")).toBe("Obrigatório");
  });

  it("aceita texto", () => {
    expect(requiredError("Ana", "Obrigatório")).toBeUndefined();
  });
});
