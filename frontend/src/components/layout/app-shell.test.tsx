import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mockMatchMedia } from "@/test-utils/match-media";
import { FakeAuth } from "@/test-utils/providers";
import { AppShell, MAIN_CONTENT_ID } from "./app-shell";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function renderShell() {
  mockMatchMedia(false);
  const router = createMemoryRouter(
    [{ path: "*", element: <AppShell><p>Conteúdo da página</p></AppShell> }],
    { initialEntries: ["/"] },
  );
  const view = render(
    <FakeAuth>
      <RouterProvider router={router} />
    </FakeAuth>,
  );
  return Object.assign(router, { unmount: view.unmount });
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

it("a area de conteudo cresce com o monitor, sem teto fixo que deixe faixas vazias", () => {
  renderShell();
  const main = screen.getByRole("main");
  expect(main).toHaveClass("max-w-6xl", "xl:max-w-7xl", "2xl:max-w-[96rem]", "mx-auto", "w-full");
});

const sidebar = () => document.getElementById("sidebar") as HTMLElement;
const sidebarToggle = () => screen.getByRole("button", { name: /menu lateral/ });
const brandsInHeader = () => within(screen.getByRole("banner")).getAllByText("Pecúlio").length;

it("o menu lateral aparece por padrao, com o botao de ocultar", () => {
  renderShell();
  expect(sidebarToggle()).toHaveAccessibleName("Ocultar menu lateral");
  expect(sidebarToggle()).toHaveAttribute("aria-expanded", "true");
  expect(sidebarToggle()).toHaveAttribute("aria-controls", "sidebar");
  expect(sidebar()).toHaveClass("lg:flex");
  expect(screen.getByRole("main").parentElement).toHaveClass("lg:pl-60");
  expect(brandsInHeader()).toBe(1);
});

it("ocultar tira o menu e o recuo do conteudo, mostra a marca no cabecalho e troca o botao", async () => {
  renderShell();
  await userEvent.click(sidebarToggle());
  expect(sidebarToggle()).toHaveAccessibleName("Mostrar menu lateral");
  expect(sidebarToggle()).toHaveAttribute("aria-expanded", "false");
  expect(sidebar()).not.toHaveClass("lg:flex");
  expect(screen.getByRole("main").parentElement).not.toHaveClass("lg:pl-60");
  expect(brandsInHeader()).toBe(2);
});

it("mostrar de novo devolve o menu", async () => {
  renderShell();
  await userEvent.click(sidebarToggle());
  await userEvent.click(sidebarToggle());
  expect(sidebar()).toHaveClass("lg:flex");
  expect(screen.getByRole("main").parentElement).toHaveClass("lg:pl-60");
});

it("a escolha fica guardada e o app abre do mesmo jeito", async () => {
  const first = renderShell();
  await userEvent.click(sidebarToggle());
  expect(window.localStorage.getItem("peculio:sidebar-hidden")).toBe("1");
  first.unmount();
  renderShell();
  expect(sidebarToggle()).toHaveAccessibleName("Mostrar menu lateral");
  expect(sidebar()).not.toHaveClass("lg:flex");
});

it("Ctrl+B oculta e mostra o menu", async () => {
  renderShell();
  await userEvent.keyboard("{Control>}b{/Control}");
  expect(sidebarToggle()).toHaveAccessibleName("Mostrar menu lateral");
  await userEvent.keyboard("{Control>}b{/Control}");
  expect(sidebarToggle()).toHaveAccessibleName("Ocultar menu lateral");
});

it("o botao diz o atalho no titulo e declara a tecla para leitor de tela", () => {
  renderShell();
  expect(sidebarToggle()).toHaveAttribute("title", "Ocultar menu lateral (Ctrl+B)");
  expect(sidebarToggle()).toHaveAttribute("aria-keyshortcuts", "Control+B Meta+B");
});

it("a gaveta do celular continua igual com o menu lateral oculto", async () => {
  renderShell();
  await userEvent.click(sidebarToggle());
  await userEvent.click(openButton());
  expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
});
