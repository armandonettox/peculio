import { expect, it } from "vitest";

import { ApiError } from "@/api/errors";
import { createQueryClient } from "./query-client";

function retryFn() {
  const retry = createQueryClient().getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") throw new Error("retry deveria ser uma funcao");
  return retry;
}

it("nao repete em erro 4xx", () => {
  const retry = retryFn();
  for (const status of [400, 401, 403, 404, 422, 429]) {
    expect(retry(0, new ApiError(status, "x", "x"))).toBe(false);
  }
});

it("repete em erro de servidor ate o limite", () => {
  const retry = retryFn();
  const error = new ApiError(500, "internal_error", "x");
  expect(retry(0, error)).toBe(true);
  expect(retry(1, error)).toBe(true);
  expect(retry(2, error)).toBe(false);
});

it("repete em falha de rede", () => {
  expect(retryFn()(0, ApiError.network())).toBe(true);
});

it("mutacoes nunca repetem sozinhas", () => {
  expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
});
