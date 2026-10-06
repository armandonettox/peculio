import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// Servidor de mentira para a API. Cada teste registra os handlers de que precisa com
// server.use(...). Pedido sem handler falha o teste, para nada chamar a rede de verdade.
// Por padrao nao ha sessao guardada (cookie): restaurar responde 401, e sair responde 204. Um teste que precise de outra
// coisa troca com server.use.
export const server = setupServer(
  http.post("*/api/v1/auth/session", () =>
    HttpResponse.json({ detail: "Sessao invalida, entre novamente", code: "session_invalid" }, { status: 401 }),
  ),
  http.post("*/api/v1/auth/logout", () => new HttpResponse(null, { status: 204 })),
);

export const sampleUser = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ana Teste",
  email: "ana@example.com",
  is_admin: true, default_currency: "BRL",
};
