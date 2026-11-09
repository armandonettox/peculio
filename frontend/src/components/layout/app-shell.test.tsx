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

const bottomNav = () => screen.getByRole("navigation", { name: "Navegação inferior" });
const moreButton = () => within(bottomNav()).getByRole("button", { name: "Mais" });

it("no celular nao ha botao de menu nem gaveta: a navegacao e a barra inferior", () => {
  renderShell();
  expect(screen.queryByRole("button", { name: "Abrir menu" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(bottomNav()).toHaveClass("lg:hidden", "fixed", "bottom-0");
});

it("a barra inferior tem Principal, Transacoes, o botao de novo lancamento no meio, Planejamento e Mais", () => {
  renderShell();
  const items = within(bottomNav()).getAllByRole("listitem");
  expect(items).toHaveLength(5);
  expect(within(items[0]).getByRole("link", { name: "Principal" })).toHaveAttribute("href", "/");
  expect(within(items[1]).getByRole("link", { name: "Transações" })).toHaveAttribute("href", "/transacoes");
  expect(within(items[2]).getByRole("button", { name: "Novo lançamento" })).toBeInTheDocument();
  expect(within(items[3]).getByRole("link", { name: "Planejamento" })).toHaveAttribute("href", "/orcamentos");
  expect(within(items[4]).getByRole("button", { name: "Mais" })).toBeInTheDocument();
});

it("a aba da pagina atual fica destacada e marcada para leitor de tela", () => {
  renderShell();
  const current = within(bottomNav()).getByRole("link", { name: "Principal" });
  expect(current).toHaveAttribute("aria-current", "page");
  expect(current).toHaveClass("bg-accent");
  expect(within(bottomNav()).getByRole("link", { name: "Transações" })).not.toHaveAttribute("aria-current");
});

it("o botao do meio abre as quatro opcoes de lancamento", async () => {
  renderShell();
  await userEvent.click(within(bottomNav()).getByRole("button", { name: "Novo lançamento" }));
  const menu = screen.getByRole("menu");
  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Despesa",
    "Receita",
    "Despesa de Cartão",
    "Transferência",
  ]);
});

it("o Mais abre com as telas que nao cabem na barra, e fecha ao escolher uma", async () => {
  const router = renderShell();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(moreButton());

  const dialog = screen.getByRole("dialog", { name: "Mais" });
  const links = within(dialog).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]);
  expect(links).toEqual([
    ["Contas", "/contas"],
    ["Cartões de crédito", "/cartoes"],
    ["Importar extrato", "/importar"],
    ["Categorias", "/categorias"],
    ["Tags", "/tags"],
    ["Cofrinhos", "/cofrinhos"],
    ["Regras", "/regras"],
    ["Relatórios", "/relatorios"],
    ["Configurações", "/configuracoes"],
  ]);

  await userEvent.click(within(dialog).getByRole("link", { name: "Contas" }));
  expect(router.state.location.pathname).toBe("/contas");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("o Mais fecha com Esc e devolve o foco ao botao", async () => {
  renderShell();
  await userEvent.click(moreButton());
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(moreButton()).toHaveFocus();
});

it("o Mais fecha quando a rota muda por outro caminho (voltar/avancar)", async () => {
  const router = renderShell();
  await userEvent.click(moreButton());
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(() => router.navigate("/outra-pagina"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("o Mais fica destacado quando a pagina atual e uma das que moram nele", async () => {
  const router = renderShell();
  await act(() => router.navigate("/cofrinhos"));
  expect(moreButton()).toHaveClass("bg-accent");
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

it("colapsar reduz o menu para icones, ajusta o recuo do conteudo, mostra a marca no cabecalho e troca o botao", async () => {
  renderShell();
  await userEvent.click(sidebarToggle());
  expect(sidebarToggle()).toHaveAccessibleName("Mostrar menu lateral");
  expect(sidebarToggle()).toHaveAttribute("aria-expanded", "false");
  expect(sidebar()).toHaveClass("lg:flex");
  expect(sidebar()).toHaveClass("w-16");
  expect(sidebar()).not.toHaveClass("w-60");
  expect(screen.getByRole("main").parentElement).toHaveClass("lg:pl-16");
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
  expect(sidebar()).toHaveClass("w-16");
  expect(sidebar()).not.toHaveClass("w-60");
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

it("ocultar o menu lateral do desktop nao mexe na barra inferior do celular", async () => {
  renderShell();
  await userEvent.click(sidebarToggle());
  expect(bottomNav()).toBeInTheDocument();
  expect(within(bottomNav()).getAllByRole("listitem")).toHaveLength(5);
});

it("a marca no menu lateral e um link que leva ao painel inicial", async () => {
  mockMatchMedia(false);
  const router = createMemoryRouter([{ path: "*", element: <AppShell><p>Conteúdo da página</p></AppShell> }], {
    initialEntries: ["/contas"],
  });
  render(
    <FakeAuth>
      <RouterProvider router={router} />
    </FakeAuth>,
  );
  const link = within(sidebar()).getByRole("link", { name: "Pecúlio" });
  expect(link).toHaveAttribute("href", "/");
  expect(link).toHaveAttribute("title", "Ir para o painel inicial");
  await userEvent.click(link);
  expect(router.state.location.pathname).toBe("/");
});
