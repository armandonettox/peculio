import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "@/test-utils/msw";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

// Limpa o DOM entre os testes, senao um teste enxerga elementos do anterior
afterEach(() => {
  cleanup();
  server.resetHandlers();
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});
