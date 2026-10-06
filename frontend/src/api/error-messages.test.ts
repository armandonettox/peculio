import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import en from "@/i18n/locales/en.json";
import ptBR from "@/i18n/locales/pt-BR.json";
import { getErrorMessage, hasErrorMessage } from "./error-messages";
import { ApiError } from "./errors";

// Le os codigos direto do backend. Se alguem criar um ErrorCode e esquecer a mensagem em
// traducao, o usuario veria o texto cru do servidor; este teste acusa na hora (nos dois idiomas).
function readBackendErrorCodes(): string[] {
  const source = readFileSync(path.resolve(__dirname, "../../../backend/app/core/errors.py"), "utf-8");
  const enumBlock = source.match(/class ErrorCode\(StrEnum\):([\s\S]*?)\r?\n\r?\nclass /);
  if (!enumBlock) throw new Error("ErrorCode nao encontrado em backend/app/core/errors.py");
  return [...enumBlock[1].matchAll(/^\s+[A-Z_]+ = "([a-z_]+)"/gm)].map((match) => match[1]);
}

describe("mensagens de erro", () => {
  const backendCodes = readBackendErrorCodes();

  it("le os codigos do backend", () => {
    expect(backendCodes.length).toBeGreaterThan(10);
  });

  it.each(backendCodes)("o codigo %s tem mensagem em portugues e em ingles", (code) => {
    expect(hasErrorMessage(code), `falta mensagem para ${code}`).toBe(true);
    expect((ptBR.errors as Record<string, string>)[code], `falta em pt-BR: ${code}`).toBeTruthy();
    expect((en.errors as Record<string, string>)[code], `falta em ingles: ${code}`).toBeTruthy();
  });

  it("nao ha mensagem para codigo que o backend nao tem (exceto os do cliente)", () => {
    const clientOnly = ["network_error"];
    const extra = Object.keys(ptBR.errors).filter(
      (code) => code !== "fallback" && !backendCodes.includes(code) && !clientOnly.includes(code),
    );
    expect(extra).toEqual([]);
  });
});

describe("getErrorMessage", () => {
  it("usa a mensagem do codigo conhecido", () => {
    const error = new ApiError(401, "invalid_credentials", "Email ou senha invalidos");
    expect(getErrorMessage(error)).toBe("E-mail ou senha incorretos.");
  });

  it("cai no texto do servidor quando o codigo e desconhecido", () => {
    const error = new ApiError(418, "codigo_novo", "Texto do servidor");
    expect(getErrorMessage(error)).toBe("Texto do servidor");
  });

  it("devolve mensagem generica para erro que nao e ApiError", () => {
    expect(getErrorMessage(new Error("detalhe tecnico"))).toBe("Algo deu errado. Tente novamente.");
    expect(getErrorMessage("texto")).toBe("Algo deu errado. Tente novamente.");
  });

  it("nao mostra detalhe tecnico de erro de rede", () => {
    expect(getErrorMessage(ApiError.network())).toContain("conectar ao servidor");
  });
});

describe("mensagens de erro em ingles", () => {
  it("a mesma funcao responde no idioma em uso", async () => {
    await i18n.changeLanguage("en");
    expect(getErrorMessage(new ApiError(401, "invalid_credentials", "x"))).toBe("Incorrect email or password.");
    expect(getErrorMessage(new Error("detalhe tecnico"))).toBe("Something went wrong. Try again.");
    expect(getErrorMessage(ApiError.network())).toContain("connect to the server");
    expect(getErrorMessage(new ApiError(418, "codigo_novo", "Texto do servidor"))).toBe("Texto do servidor");
  });

  it('"fallback" nao e tratado como um codigo de erro', () => {
    expect(hasErrorMessage("fallback")).toBe(false);
    expect(getErrorMessage(new ApiError(500, "fallback", "Texto do servidor"))).toBe("Texto do servidor");
  });
});
