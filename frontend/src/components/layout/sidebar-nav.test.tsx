import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { navItems } from "./nav-items";
import { SidebarNav } from "./sidebar-nav";

function renderNav(path = "/", onNavigate?: () => void) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarNav onNavigate={onNavigate} />
    </MemoryRouter>,
  );
}

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

it("itens sem tela aparecem desabilitados e nao sao links", () => {
  renderNav();
  expect(screen.queryByRole("link", { name: /Configurações/ })).not.toBeInTheDocument();
  const disabled = navItems.filter((item) => !item.to);
  expect(disabled.length).toBeGreaterThan(0);
  expect(screen.getAllByText("Em breve")).toHaveLength(disabled.length);
  expect(screen.getByText("Configurações").closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
});

it("chama onNavigate ao clicar num item, mesmo na pagina atual", async () => {
  const onNavigate = vi.fn();
  renderNav("/", onNavigate);
  await userEvent.click(screen.getByRole("link", { name: "Painel" }));
  expect(onNavigate).toHaveBeenCalledOnce();
});

it("clicar num item desabilitado nao faz nada", async () => {
  const onNavigate = vi.fn();
  renderNav("/", onNavigate);
  await userEvent.click(screen.getByText("Configurações"));
  expect(onNavigate).not.toHaveBeenCalled();
});
