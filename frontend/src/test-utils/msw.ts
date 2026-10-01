import { setupServer } from "msw/node";

// Servidor de mentira para a API. Cada teste registra os handlers de que precisa com
// server.use(...). Pedido sem handler falha o teste, para nada chamar a rede de verdade.
export const server = setupServer();

export const sampleUser = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ana Teste",
  email: "ana@example.com",
  is_admin: true, default_currency: "BRL",
};
