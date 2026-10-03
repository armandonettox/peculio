import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { LocationProbe } from "@/test-utils/location-probe";
import { mockMatchMedia } from "@/test-utils/match-media";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import App from "./App";

afterEach(() => vi.unstubAllGlobals());

const statusHandler = (setupRequired: boolean) =>
  http.get("*/api/v1/auth/status", () => HttpResponse.json({ setup_required: setupRequired }));

// O layout espera o relogio do servidor antes de mostrar a tela (o "hoje" do app e o do servidor)
const clockHandler = http.get("*/api/v1/clock", () =>
  HttpResponse.json({ now: new Date().toISOString(), timezone: "America/Sao_Paulo", today: "2026-03-12" }),
);

function renderAt(path: string, user: Parameters<typeof FakeAuth>[0]["user"]) {
  mockMatchMedia(false);
  server.use(clockHandler);
  return render(
    <FakeAuth user={user}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </FakeAuth>,
  );
}

const location = () => screen.getByTestId("location");

it("sem login, a raiz leva para /login sem ?next=", async () => {
  server.use(statusHandler(false));
  renderAt("/", null);
  expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  expect(location()).toHaveTextContent(/^\/login$/);
});

it("sem login, uma pagina interna leva para /login guardando o destino", async () => {
  server.use(statusHandler(false));
  renderAt("/contas?aba=extrato", null);
  expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  expect(location()).toHaveTextContent("/login?next=%2Fcontas%3Faba%3Dextrato");
});

it("sem login e instancia vazia, /login leva para criar o administrador", async () => {
  server.use(statusHandler(true));
  renderAt("/login", null);
  expect(await screen.findByRole("heading", { name: "Criar conta de administrador" })).toBeInTheDocument();
  expect(location()).toHaveTextContent("/register");
});

it("logado, a raiz mostra o painel com a saudacao dentro do layout", async () => {
  renderAt("/", { id: "1", name: "Ana Teste", email: "ana@example.com", is_admin: true, default_currency: "BRL" });
  expect(await screen.findByRole("heading", { level: 1, name: "Painel" })).toBeInTheDocument();
  expect(screen.getByText(/Olá, Ana\./)).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Navegação principal" })).toBeInTheDocument();
});

it("logado, /login e /register levam para o painel", async () => {
  renderAt("/login", { id: "1", name: "Ana", email: "ana@example.com", is_admin: true, default_currency: "BRL" });
  expect(await screen.findByRole("heading", { level: 1, name: "Painel" })).toBeInTheDocument();
  expect(location()).toHaveTextContent(/^\/$/);
});

it("logado, endereco inexistente mostra a pagina nao encontrada dentro do layout", async () => {
  renderAt("/nao-existe", { id: "1", name: "Ana", email: "ana@example.com", is_admin: true, default_currency: "BRL" });
  expect(await screen.findByRole("heading", { level: 1, name: "Página não encontrada" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Voltar ao painel" })).toHaveAttribute("href", "/");
  expect(screen.getByRole("navigation", { name: "Navegação principal" })).toBeInTheDocument();
});

it("logado, o layout segura a tela ate o relogio do servidor chegar", async () => {
  mockMatchMedia(false);
  server.use(
    http.get("*/api/v1/clock", async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return HttpResponse.json({ now: new Date().toISOString(), timezone: "America/Sao_Paulo", today: "2026-03-12" });
    }),
  );
  render(
    <FakeAuth user={{ id: "1", name: "Ana", email: "ana@example.com", is_admin: true, default_currency: "BRL" }}>
      <MemoryRouter initialEntries={["/"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </FakeAuth>,
  );
  // O menu ja aparece; o conteudo da pagina so depois do relogio
  expect(screen.getByRole("navigation", { name: "Navegação principal" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { level: 1, name: "Painel" })).not.toBeInTheDocument();
  expect(await screen.findByRole("heading", { level: 1, name: "Painel" })).toBeInTheDocument();
});
