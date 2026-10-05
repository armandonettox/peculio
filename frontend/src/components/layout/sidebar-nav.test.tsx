import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { Settings } from "lucide-react";

import { navItems } from "./nav-items";
import { SidebarNav } from "./sidebar-nav";

function renderNav(path = "/", onNavigate?: () => void, items?: Parameters<typeof SidebarNav>[0]["items"]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarNav onNavigate={onNavigate} items={items} />
    </MemoryRouter>,
  );
}

// Um item sem tela ("Em breve"). Nenhum item de verdade esta assim agora, mas o menu sabe mostrar um.
const comingSoon = [{ label: "Em obras", icon: Settings }];

it("mostra todos os itens do menu", () => {
  renderNav();
  for (const item of navItems) {
    expect(screen.getByText(item.label)).toBeInTheDocument();
  }
});

it("o item Contas e um link para /contas", () => {
  renderNav("/contas");
  const link = screen.getByRole("link", { name: "Contas" });
  expect(link).toHaveAttribute("href", "/contas");
  expect(link).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Painel" })).not.toHaveAttribute("aria-current");
});

it("o item Relatórios e um link para /relatorios", () => {
  renderNav("/relatorios");
  const link = screen.getByRole("link", { name: "Relatórios" });
  expect(link).toHaveAttribute("href", "/relatorios");
  expect(link).toHaveAttribute("aria-current", "page");
});

it("o item Orçamentos e um link para /orcamentos", () => {
  renderNav("/orcamentos");
  const link = screen.getByRole("link", { name: "Orçamentos" });
  expect(link).toHaveAttribute("href", "/orcamentos");
  expect(link).toHaveAttribute("aria-current", "page");
});

it("marca o painel como pagina atual", () => {
  renderNav("/");
  expect(screen.getByRole("link", { name: "Painel" })).toHaveAttribute("aria-current", "page");
});

it("todos os itens do menu tem tela: nenhum fica como Em breve", () => {
  renderNav();
  expect(navItems.filter((item) => !item.to)).toEqual([]);
  expect(screen.queryByText("Em breve")).not.toBeInTheDocument();
});

it("Configuracoes e um link para /configuracoes", () => {
  renderNav("/configuracoes");
  const link = screen.getByRole("link", { name: "Configurações" });
  expect(link).toHaveAttribute("href", "/configuracoes");
  expect(link).toHaveAttribute("aria-current", "page");
});

it("um item sem tela aparece desabilitado e nao e link", () => {
  renderNav("/", undefined, comingSoon);
  expect(screen.queryByRole("link", { name: /Em obras/ })).not.toBeInTheDocument();
  expect(screen.getAllByText("Em breve")).toHaveLength(1);
  expect(screen.getByText("Em obras").closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
});

it("chama onNavigate ao clicar num item, mesmo na pagina atual", async () => {
  const onNavigate = vi.fn();
  renderNav("/", onNavigate);
  await userEvent.click(screen.getByRole("link", { name: "Painel" }));
  expect(onNavigate).toHaveBeenCalledOnce();
});

it("clicar num item desabilitado nao faz nada", async () => {
  const onNavigate = vi.fn();
  renderNav("/", onNavigate, comingSoon);
  await userEvent.click(screen.getByText("Em obras"));
  expect(onNavigate).not.toHaveBeenCalled();
});

it("o item Regras e um link para /regras", () => {
  renderNav("/regras");
  const link = screen.getByRole("link", { name: "Regras" });
  expect(link).toHaveAttribute("href", "/regras");
  expect(link).toHaveAttribute("aria-current", "page");
});
