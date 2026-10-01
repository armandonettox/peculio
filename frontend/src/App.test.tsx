import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { mockMatchMedia } from "@/test-utils/match-media";
import App from "./App";

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  mockMatchMedia(false);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

it("na raiz mostra o painel dentro do layout", () => {
  renderAt("/");
  expect(screen.getByRole("heading", { level: 1, name: "Painel" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Navegação principal" })).toBeInTheDocument();
  expect(screen.getByText("Nenhuma conta ainda")).toBeInTheDocument();
});

it("endereco inexistente mostra a pagina nao encontrada, ainda dentro do layout", () => {
  renderAt("/nao-existe");
  expect(screen.getByRole("heading", { level: 1, name: "Página não encontrada" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Voltar ao painel" })).toHaveAttribute("href", "/");
  expect(screen.getByRole("navigation", { name: "Navegação principal" })).toBeInTheDocument();
});
