import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { mockMatchMedia } from "@/test-utils/match-media";
import { ThemeToggle } from "./theme-toggle";

afterEach(() => vi.unstubAllGlobals());

it("alterna a classe dark no html e troca o texto acessivel do botao", async () => {
  mockMatchMedia(false);
  render(<ThemeToggle />);

  const toLight = () => screen.queryByRole("button", { name: "Mudar para o tema claro" });
  const toDark = () => screen.queryByRole("button", { name: "Mudar para o tema escuro" });

  expect(toDark()).toBeInTheDocument();
  await userEvent.click(toDark()!);
  expect(document.documentElement).toHaveClass("dark");
  expect(toLight()).toBeInTheDocument();

  await userEvent.click(toLight()!);
  expect(document.documentElement).not.toHaveClass("dark");
  expect(toDark()).toBeInTheDocument();
});

it("comeca no tema escuro quando o sistema e escuro", () => {
  mockMatchMedia(true);
  render(<ThemeToggle />);
  expect(screen.getByRole("button", { name: "Mudar para o tema claro" })).toBeInTheDocument();
});
