import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { installPrompt, type InstallPromptEvent } from "@/pwa/install";
import { InstallBanner } from "./install-banner";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120";

function useUserAgent(userAgent: string) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
}

function installEvent() {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as InstallPromptEvent;
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome: "accepted" });
  return event;
}

beforeEach(() => installPrompt.set(null));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("no computador nao aparece, mesmo com o convite do navegador", () => {
  useUserAgent(DESKTOP);
  installPrompt.set(installEvent());
  const { container } = render(<InstallBanner />);
  expect(container).toBeEmptyDOMElement();
});

it("no Android sem o convite do navegador nao aparece", () => {
  useUserAgent(ANDROID);
  const { container } = render(<InstallBanner />);
  expect(container).toBeEmptyDOMElement();
});

it("no Android com o convite, o botao abre o convite do navegador", async () => {
  useUserAgent(ANDROID);
  const event = installEvent();
  render(<InstallBanner />);
  act(() => installPrompt.set(event));

  await userEvent.click(await screen.findByRole("button", { name: "Instalar app" }));

  expect(event.prompt).toHaveBeenCalledTimes(1);
  // O convite so vale uma vez: depois de usado o aviso some
  expect(screen.queryByRole("region", { name: "Instalar no celular" })).not.toBeInTheDocument();
});

it("no iPhone mostra o passo a passo do menu Compartilhar", async () => {
  useUserAgent(IPHONE);
  render(<InstallBanner />);

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Como instalar" }));

  const dialog = screen.getByRole("dialog", { name: "Instalar no iPhone" });
  expect(dialog).toHaveTextContent("Compartilhar");
  expect(dialog).toHaveTextContent("Adicionar à Tela de Início");
});

it("com o app ja instalado (aberto pelo atalho) nao aparece", () => {
  useUserAgent(IPHONE);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(display-mode: standalone)" }));
  const { container } = render(<InstallBanner />);
  expect(container).toBeEmptyDOMElement();
});

it("dispensar esconde o aviso e ele nao volta na proxima visita", async () => {
  useUserAgent(IPHONE);
  const { unmount } = render(<InstallBanner />);

  await userEvent.click(screen.getByRole("button", { name: "Dispensar aviso de instalação" }));
  expect(screen.queryByRole("region", { name: "Instalar no celular" })).not.toBeInTheDocument();

  unmount();
  const { container } = render(<InstallBanner />);
  expect(container).toBeEmptyDOMElement();
});
