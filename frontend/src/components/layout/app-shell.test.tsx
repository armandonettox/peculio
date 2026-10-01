import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { mockMatchMedia } from "@/test-utils/match-media";
import { FakeAuth } from "@/test-utils/providers";
import { AppShell, MAIN_CONTENT_ID } from "./app-shell";

afterEach(() => vi.unstubAllGlobals());

function renderShell() {
  mockMatchMedia(false);
  const router = createMemoryRouter(
    [{ path: "*", element: <AppShell><p>Conteúdo da página</p></AppShell> }],
    { initialEntries: ["/"] },
  );
  render(
    <FakeAuth>
      <RouterProvider router={router} />
    </FakeAuth>,
  );
  return router;
}

const openButton = () => screen.getByRole("button", { name: "Abrir menu" });

it("renderiza o conteudo dentro do main", () => {
  renderShell();
  const main = screen.getByRole("main");
  expect(main).toHaveAttribute("id", MAIN_CONTENT_ID);
  expect(within(main).getByText("Conteúdo da página")).toBeInTheDocument();
});

it("tem o link para pular para o conteudo apontando para o main", () => {
  renderShell();
  expect(screen.getByRole("link", { name: "Pular para o conteúdo" })).toHaveAttribute(
    "href",
    `#${MAIN_CONTENT_ID}`,
  );
});

it("tem o alternador de tema e o menu do usuario no topo", () => {
  renderShell();
  expect(screen.getByRole("button", { name: /Mudar para o tema/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Menu do usuário" })).toBeInTheDocument();
});

it("a gaveta comeca fechada e abre pelo botao do menu", async () => {
  renderShell();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await userEvent.click(openButton());

  const dialog = screen.getByRole("dialog", { name: "Menu" });
  expect(within(dialog).getByRole("navigation", { name: "Navegação principal" })).toBeInTheDocument();
});

it("a gaveta fecha com Esc e devolve o foco ao botao", async () => {
  renderShell();
  await userEvent.click(openButton());
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  await userEvent.keyboard("{Escape}");

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(openButton()).toHaveFocus();
});

it("a gaveta fecha pelo botao Fechar", async () => {
  renderShell();
  await userEvent.click(openButton());
  await userEvent.click(screen.getByRole("button", { name: "Fechar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("a gaveta fecha ao clicar num item, mesmo sendo a pagina atual", async () => {
  renderShell();
  await userEvent.click(openButton());
  const dialog = screen.getByRole("dialog");

  await userEvent.click(within(dialog).getByRole("link", { name: "Painel" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("a gaveta fecha quando a rota muda por outro caminho (voltar/avancar)", async () => {
  const router = renderShell();
  await userEvent.click(openButton());
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  await act(() => router.navigate("/outra-pagina"));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
