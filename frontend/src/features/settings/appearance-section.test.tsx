import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";

import { LANGUAGE_STORAGE_KEY } from "@/i18n/languages";
import { AppearanceSection } from "./appearance-section";

const user = userEvent.setup();

afterEach(() => {
  document.documentElement.lang = "pt-BR";
});

it("em portugues mostra os textos e o idioma atual marcado", () => {
  render(<AppearanceSection />);
  expect(screen.getByRole("heading", { level: 2, name: "Aparência" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "Tema" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "Idioma" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Português (Brasil)" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "English" })).not.toBeChecked();
});

it("os nomes dos idiomas ficam na propria lingua, em qualquer idioma da tela", async () => {
  render(<AppearanceSection />);
  await user.click(screen.getByRole("radio", { name: "English" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Appearance" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Português (Brasil)" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "English" })).toBeChecked();
});

it("escolher ingles troca a tela, guarda a escolha e avisa o navegador do idioma", async () => {
  render(<AppearanceSection />);
  await user.click(screen.getByRole("radio", { name: "English" }));

  expect(await screen.findByRole("heading", { level: 2, name: "Appearance" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "Language" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /^Light/ })).toBeInTheDocument();
  expect(screen.queryByText("Aparência")).not.toBeInTheDocument();
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
  expect(document.documentElement.lang).toBe("en");
});

it("voltar para o portugues restaura tudo", async () => {
  render(<AppearanceSection />);
  await user.click(screen.getByRole("radio", { name: "English" }));
  await screen.findByRole("heading", { level: 2, name: "Appearance" });
  await user.click(screen.getByRole("radio", { name: "Português (Brasil)" }));

  expect(await screen.findByRole("heading", { level: 2, name: "Aparência" })).toBeInTheDocument();
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("pt-BR");
  expect(document.documentElement.lang).toBe("pt-BR");
});

it("o tema continua funcionando e mostra a descricao no idioma escolhido", async () => {
  render(<AppearanceSection />);
  await user.click(screen.getByRole("radio", { name: "English" }));
  await screen.findByRole("heading", { level: 2, name: "Appearance" });
  expect(screen.getByText("Light background all the time.")).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: /^Dark/ }));
  await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
});
