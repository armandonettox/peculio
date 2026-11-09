import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { tokenStore } from "@/auth/token-store";
import { i18n, initI18n } from "@/i18n";
import { resetAppClock } from "@/lib/app-clock";
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

// O jsdom nao tem matchMedia. Por padrao os testes rodam numa tela larga (desktop: painel em duas colunas, menu lateral);
// quem testa o celular redefine window.matchMedia dentro do proprio teste.
function wideScreen() {
  window.matchMedia = ((query: string) => ({
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
wideScreen();

// findBy e waitFor desistem em 1 s por padrao. Com a suite inteira disputando CPU, as respostas
// simuladas passam disso de vez em quando e o teste falha sem ter nada errado. So atrasa quem ja falharia.
configure({ asyncUtilTimeout: 5000 });

// Os testes rodam em portugues (o idioma de origem). Quem testa outro idioma troca dentro do proprio teste.
initI18n("pt-BR");

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

// Limpa o DOM entre os testes, senao um teste enxerga elementos do anterior
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pt-BR");
  server.resetHandlers();
  // O token e um singleton em memoria: um teste nao pode herdar a sessao do anterior
  tokenStore.clear();
  // O relogio do app e global: um teste nao pode herdar a sincronizacao do anterior
  resetAppClock();
  document.documentElement.classList.remove("dark");
  localStorage.clear();
  // Um teste de celular nao pode deixar a tela estreita para o proximo
  wideScreen();
});
