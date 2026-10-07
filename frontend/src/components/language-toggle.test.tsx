import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { LanguageToggle } from "./language-toggle";

it("alterna entre portugues e ingles e troca o texto acessivel do botao", async () => {
  render(<LanguageToggle />);

  const toEnglish = () => screen.queryByRole("button", { name: "Mudar para inglês" });
  const toPortuguese = () => screen.queryByRole("button", { name: "Switch to Portuguese" });

  expect(toEnglish()).toBeInTheDocument();
  await userEvent.click(toEnglish()!);
  expect(document.documentElement.lang).toBe("en");
  expect(toPortuguese()).toBeInTheDocument();

  await userEvent.click(toPortuguese()!);
  expect(document.documentElement.lang).toBe("pt-BR");
  expect(toEnglish()).toBeInTheDocument();
});
