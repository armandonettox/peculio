import { describe, expect, it } from "vitest";

import {
  inviteLink,
  inviteState,
  MAX_NAME_LENGTH,
  passwordFormErrors,
  profileChanges,
  profileErrors,
  securityContactError,
  securityContactHref,
} from "./model";

describe("profileErrors", () => {
  it("perfil completo nao tem erro", () => {
    expect(profileErrors({ name: "Ana Souza", currency: "BRL" })).toEqual({});
  });

  it.each([
    ["", "Informe o nome."],
    ["   ", "Informe o nome."],
    ["x".repeat(MAX_NAME_LENGTH + 1), `Use no máximo ${MAX_NAME_LENGTH} letras.`],
  ])("nome %j", (name, message) => expect(profileErrors({ name, currency: "BRL" }).name).toBe(message));

  it("o limite exato do nome passa", () => {
    expect(profileErrors({ name: "x".repeat(MAX_NAME_LENGTH), currency: "BRL" })).toEqual({});
  });

  it("o limite e o do servidor: 200 passa e 201 nao", () => {
    // Fixo de proposito: o servidor recusa acima de 200, e a constante nao pode andar sozinha
    expect(profileErrors({ name: "x".repeat(200), currency: "BRL" })).toEqual({});
    expect(profileErrors({ name: "x".repeat(201), currency: "BRL" }).name).toBeDefined();
  });

  it("o limite conta o nome sem os espacos das pontas", () => {
    expect(profileErrors({ name: ` ${"x".repeat(MAX_NAME_LENGTH)} `, currency: "BRL" })).toEqual({});
  });

  it("moeda e obrigatoria", () => {
    expect(profileErrors({ name: "Ana", currency: "" }).currency).toBe("Escolha a moeda.");
  });
});

describe("profileChanges", () => {
  const saved = { name: "Ana Souza", default_currency: "BRL" };

  it("sem mudanca nao ha o que salvar", () => {
    expect(profileChanges({ name: "Ana Souza", currency: "BRL" }, saved)).toBeNull();
  });

  it("espacos nas pontas nao contam como mudanca", () => {
    expect(profileChanges({ name: "  Ana Souza  ", currency: "BRL" }, saved)).toBeNull();
  });

  it("so manda o campo que mudou", () => {
    expect(profileChanges({ name: "Ana Maria", currency: "BRL" }, saved)).toEqual({ name: "Ana Maria" });
    expect(profileChanges({ name: "Ana Souza", currency: "USD" }, saved)).toEqual({ default_currency: "USD" });
  });

  it("manda os dois quando os dois mudam, com o nome aparado", () => {
    expect(profileChanges({ name: " Bia ", currency: "EUR" }, saved)).toEqual({ name: "Bia", default_currency: "EUR" });
  });
});

describe("passwordFormErrors", () => {
  const ok = { current: "SenhaAtual123", next: "NovaSenha456", confirm: "NovaSenha456" };

  it("formulario certo nao tem erro", () => expect(passwordFormErrors(ok)).toEqual({}));

  it("pede a senha atual", () => {
    expect(passwordFormErrors({ ...ok, current: "" }).current).toBe("Informe a senha atual.");
  });

  it("a nova senha segue a regra do cadastro", () => {
    expect(passwordFormErrors({ ...ok, next: "curta", confirm: "curta" }).next).toBe("A senha precisa ter pelo menos 8 caracteres.");
    const long = "a".repeat(73);
    expect(passwordFormErrors({ ...ok, next: long, confirm: long }).next).toBe("A senha é muito longa (máximo de 72 bytes).");
  });

  it("a nova senha precisa ser diferente da atual", () => {
    expect(passwordFormErrors({ current: "MesmaSenha1", next: "MesmaSenha1", confirm: "MesmaSenha1" }).next).toBe(
      "A nova senha precisa ser diferente da atual.",
    );
  });

  it("a confirmacao precisa bater", () => {
    expect(passwordFormErrors({ ...ok, confirm: "Outra123456" }).confirm).toBe("As senhas não conferem.");
  });

  it("com a nova senha invalida, nao reclama da confirmacao ao mesmo tempo", () => {
    const errors = passwordFormErrors({ ...ok, next: "curta", confirm: "" });
    expect(errors.next).toBeDefined();
    expect(errors.confirm).toBeUndefined();
  });

  it("mostra todos os erros de uma vez", () => {
    expect(Object.keys(passwordFormErrors({ current: "", next: "", confirm: "x" })).sort()).toEqual(["current", "next"]);
  });
});

describe("inviteLink", () => {
  it("leva o codigo para o cadastro", () => {
    expect(inviteLink("https://app.example.com", "abc123")).toBe("https://app.example.com/register?invite=abc123");
  });

  it("codifica o que nao e seguro na URL", () => {
    expect(inviteLink("http://localhost:8181", "a+b/c=d&e")).toBe("http://localhost:8181/register?invite=a%2Bb%2Fc%3Dd%26e");
  });
});

describe("inviteState", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  const iso = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  it("usado vale mais que o prazo", () => {
    expect(inviteState({ used_at: "2026-03-05T10:00:00Z", expires_at: iso(-3) }, now)).toEqual({ kind: "used", label: "Usado" });
    expect(inviteState({ used_at: "2026-03-05T10:00:00Z", expires_at: iso(5) }, now).kind).toBe("used");
  });

  it("vencido", () => {
    expect(inviteState({ used_at: null, expires_at: iso(-1) }, now)).toEqual({ kind: "expired", label: "Vencido" });
  });

  it("vence agora conta como vencido", () => {
    expect(inviteState({ used_at: null, expires_at: now.toISOString() }, now).kind).toBe("expired");
  });

  it.each([
    [7, "Vence em 7 dias"],
    [2, "Vence em 2 dias"],
    [1, "Vence em 1 dia"],
    [0.5, "Vence em 1 dia"],
  ])("faltando %s dias", (days, label) => {
    expect(inviteState({ used_at: null, expires_at: iso(days) }, now)).toEqual({ kind: "pending", label });
  });
});

describe("securityContactError", () => {
  it.each([
    [""],
    ["   "],
    ["seguranca@example.com"],
    ["  seguranca@example.com  "],
    ["https://exemplo.com/contato"],
    ["HTTPS://exemplo.com/contato"],
    ["https://exemplo.com:8443/a?b=1#c"],
  ])("%j e aceito", (value) => expect(securityContactError(value)).toBeUndefined());

  it.each([
    ["isto nao e um contato"],
    ["sem-arroba.example.com"],
    ["a@b"],
    ["http://exemplo.com/contato"],
    ["javascript:alert(1)"],
    ["mailto:alguem@example.com"],
    ["ftp://exemplo.com"],
    ["https://"],
    ["https://usuario:senha@exemplo.com/"],
    ["https://exemplo.com/com espaco"],
  ])("%j e recusado", (value) => expect(securityContactError(value)).toBeDefined());

  it("o limite de 200 caracteres e o do servidor: 200 passa e 201 nao", () => {
    // Fixo de proposito: o servidor recusa acima de 200, e a constante nao pode andar sozinha
    const base = "https://exemplo.com/";
    expect(securityContactError(base + "a".repeat(200 - base.length))).toBeUndefined();
    expect(securityContactError(base + "a".repeat(201 - base.length))).toBe("Use no máximo 200 caracteres.");
  });

  it("o limite conta sem os espacos das pontas", () => {
    const base = "https://exemplo.com/";
    expect(securityContactError(` ${base}${"a".repeat(200 - base.length)} `)).toBeUndefined();
  });

  it("a mensagem diz o que e aceito", () => {
    expect(securityContactError("nada")).toBe("Informe um e-mail válido ou um endereço que comece com https://.");
    expect(securityContactError("https://")).toBe("O endereço https:// não é válido.");
  });
});

describe("securityContactHref", () => {
  it("e-mail abre o programa de e-mail", () => {
    expect(securityContactHref("seguranca@example.com")).toBe("mailto:seguranca@example.com");
  });

  it("endereco https abre o proprio endereco", () => {
    expect(securityContactHref("https://exemplo.com/contato")).toBe("https://exemplo.com/contato");
    expect(securityContactHref("HTTPS://exemplo.com/contato")).toBe("HTTPS://exemplo.com/contato");
  });
});
