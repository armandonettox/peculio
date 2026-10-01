import { describe, expect, it } from "vitest";

import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it.each([
    ["/contas", "/contas"],
    ["/contas/123?aba=extrato", "/contas/123?aba=extrato"],
    ["/relatorios#mensal", "/relatorios#mensal"],
    ["/", "/"],
  ])("aceita o caminho interno %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["nada", null],
    ["undefined", undefined],
    ["vazio", ""],
  ])("usa o padrao quando vem %s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it.each([
    "//evil.com",
    "//evil.com/contas",
    "/\\evil.com",
    "/\\/evil.com",
    "https://evil.com",
    "http://evil.com/contas",
    "javascript:alert(1)",
    "evil.com",
    "contas",
    "/contas\\..\\evil",
    "/contas\nSet-Cookie: x=1",
    "/contas\t//evil.com",
    "/\u0000contas",
    // O URL resolve os ".." e o caminho final viraria "//evil.com"
    "/x/../..//evil.com",
    "/%2F%2Fevil.com/../..//evil.com",
    "/a/b/../../..//evil.com",
  ])("rejeita o destino perigoso %j", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it.each(["/login", "/login?next=/contas", "/register", "/register/convite"])(
    "nao volta para a tela de autenticacao (%s)",
    (input) => {
      expect(safeNextPath(input)).toBe("/");
    },
  );

  it("respeita o valor padrao informado", () => {
    expect(safeNextPath("//evil.com", "/painel")).toBe("/painel");
  });

  it("nao confunde caminho parecido com o de login", () => {
    expect(safeNextPath("/loginx")).toBe("/loginx");
  });
});
