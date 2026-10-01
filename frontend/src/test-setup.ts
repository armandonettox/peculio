import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { tokenStore } from "@/auth/token-store";
import { server } from "@/test-utils/msw";

// O jsdom nao implementa estes metodos de ponteiro, que o Radix (menu, gaveta) chama
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

// Limpa o DOM entre os testes, senao um teste enxerga elementos do anterior
afterEach(() => {
  cleanup();
  server.resetHandlers();
  // O token e um singleton em memoria: um teste nao pode herdar a sessao do anterior
  tokenStore.clear();
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});
