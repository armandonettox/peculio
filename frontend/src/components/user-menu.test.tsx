import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { FakeAuth, testUser } from "@/test-utils/providers";
import { UserMenu } from "./user-menu";

const trigger = () => screen.getByRole("button", { name: "Menu do usuário" });

it("mostra as iniciais do nome no botao", () => {
  render(
    <FakeAuth user={{ ...testUser, name: "Ana Maria Souza" }}>
      <UserMenu />
    </FakeAuth>,
  );
  expect(trigger()).toHaveTextContent("AS");
});

it("com um nome so usa uma inicial", () => {
  render(
    <FakeAuth user={{ ...testUser, name: "ana" }}>
      <UserMenu />
    </FakeAuth>,
  );
  expect(trigger()).toHaveTextContent("A");
});

it("comeca fechado e abre mostrando nome e e-mail", async () => {
  render(
    <FakeAuth>
      <UserMenu />
    </FakeAuth>,
  );
  expect(screen.queryByText(testUser.email)).not.toBeInTheDocument();

  await userEvent.click(trigger());

  expect(screen.getByText(testUser.name)).toBeInTheDocument();
  expect(screen.getByText(testUser.email)).toBeInTheDocument();
});

it("Sair chama o logout", async () => {
  const logout = vi.fn();
  render(
    <FakeAuth logout={logout}>
      <UserMenu />
    </FakeAuth>,
  );
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole("menuitem", { name: "Sair" }));
  expect(logout).toHaveBeenCalledOnce();
});

it("fecha com Esc e devolve o foco ao botao", async () => {
  render(
    <FakeAuth>
      <UserMenu />
    </FakeAuth>,
  );
  await userEvent.click(trigger());
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger()).toHaveFocus();
});

it("sem usuario nao mostra nada", () => {
  const { container } = render(
    <FakeAuth user={null}>
      <UserMenu />
    </FakeAuth>,
  );
  expect(container).toBeEmptyDOMElement();
});
