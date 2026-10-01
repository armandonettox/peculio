import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it } from "vitest";

import { LocationProbe } from "@/test-utils/location-probe";
import { FakeAuth, testUser } from "@/test-utils/providers";
import { ProtectedRoute, PublicOnlyRoute } from "./protected-route";

function renderAt(path: string, loggedIn: boolean) {
  return render(
    <FakeAuth user={loggedIn ? testUser : null}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<p>Area interna: raiz</p>} />
            <Route path="/contas" element={<p>Area interna: contas</p>} />
          </Route>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<p>Tela de login</p>} />
          </Route>
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </FakeAuth>,
  );
}

const location = () => screen.getByTestId("location");

it("logado entra na rota protegida", () => {
  renderAt("/contas", true);
  expect(screen.getByText("Area interna: contas")).toBeInTheDocument();
});

it("deslogado e mandado para o login guardando o destino", () => {
  renderAt("/contas", false);
  expect(screen.getByText("Tela de login")).toBeInTheDocument();
  expect(location()).toHaveTextContent("/login?next=%2Fcontas");
});

it("guarda tambem a query string do destino", () => {
  renderAt("/contas?aba=extrato", false);
  expect(location()).toHaveTextContent("/login?next=%2Fcontas%3Faba%3Dextrato");
});

it("da raiz vai para /login limpo, sem ?next=", () => {
  renderAt("/", false);
  expect(location()).toHaveTextContent(/^\/login$/);
});

it("logado que abre o login volta para o painel", () => {
  renderAt("/login", true);
  expect(screen.getByText("Area interna: raiz")).toBeInTheDocument();
});

it("logado que abre o login com ?next= vai para o destino", () => {
  renderAt("/login?next=%2Fcontas", true);
  expect(screen.getByText("Area interna: contas")).toBeInTheDocument();
});

it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"])(
  "?next= perigoso (%s) nunca leva para fora do app",
  (next) => {
    renderAt(`/login?next=${encodeURIComponent(next)}`, true);
    expect(screen.getByText("Area interna: raiz")).toBeInTheDocument();
    expect(location()).toHaveTextContent(/^\/$/);
  },
);
