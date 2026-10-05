import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";

describe("ApiError.fromResponse", () => {
  it("le detail e code do formato do backend", () => {
    const error = ApiError.fromResponse(401, { detail: "Email ou senha invalidos", code: "invalid_credentials" });
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(401);
    expect(error.code).toBe("invalid_credentials");
    expect(error.message).toBe("Email ou senha invalidos");
    expect(error.fieldErrors).toEqual([]);
  });

  it("le a lista de campos do erro de validacao", () => {
    const error = ApiError.fromResponse(422, {
      detail: "Dados invalidos",
      code: "validation_error",
      errors: [{ field: "password", message: "Senha deve ter pelo menos 8 caracteres" }],
    });
    expect(error.fieldErrors).toEqual([
      { field: "password", message: "Senha deve ter pelo menos 8 caracteres" },
    ]);
  });

  it("ignora itens malformados na lista de campos", () => {
    const error = ApiError.fromResponse(422, {
      detail: "x",
      code: "validation_error",
      errors: [{ field: "email" }, null, "texto", { field: "name", message: "ok" }],
    });
    expect(error.fieldErrors).toEqual([{ field: "name", message: "ok" }]);
  });

  it("aguenta corpo fora do formato (proxy devolvendo HTML, corpo vazio)", () => {
    for (const body of [undefined, null, "<html>502</html>", 42]) {
      const error = ApiError.fromResponse(502, body);
      expect(error.status).toBe(502);
      expect(error.code).toBe("http_502");
      expect(error.message).toBeTruthy();
    }
  });
});

it("ApiError.network usa status 0 e o codigo network_error", () => {
  const error = ApiError.network();
  expect(error.status).toBe(0);
  expect(error.code).toBe("network_error");
});

describe("ApiError.lockedIds", () => {
  it("le a lista de lancamentos travados do corpo", () => {
    const error = ApiError.fromResponse(409, { detail: "x", code: "transactions_locked", locked_ids: ["a", "b"] });
    expect(error.code).toBe("transactions_locked");
    expect(error.lockedIds).toEqual(["a", "b"]);
  });

  it("sem a lista, fica vazia", () => {
    expect(ApiError.fromResponse(409, { detail: "x", code: "y" }).lockedIds).toEqual([]);
    expect(ApiError.network().lockedIds).toEqual([]);
  });

  it("ignora o que nao e texto e uma lista que nao e lista", () => {
    expect(ApiError.fromResponse(409, { locked_ids: ["a", 3, null] }).lockedIds).toEqual(["a"]);
    expect(ApiError.fromResponse(409, { locked_ids: "a" }).lockedIds).toEqual([]);
  });
});
