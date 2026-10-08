import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";

import { i18n } from "@/i18n";
import { server } from "@/test-utils/msw";
import { AppProviders } from "@/test-utils/providers";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import LoginPage from "./login";

// A tela de entrada e o menu, no idioma ingles: prova que nenhum texto ficou preso em portugues
it("a tela de login aparece em ingles", async () => {
  await i18n.changeLanguage("en");
  server.use(http.get("*/api/v1/auth/status", () => HttpResponse.json({ setup_required: false })));
  render(
    <AppProviders>
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>
    </AppProviders>,
  );
  expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByText("Sign in to see your finances.")).toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(screen.getByLabelText("Password", { exact: true })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Keep me signed in/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByText(/Got an invitation\?/)).toBeInTheDocument();
  // Nada em portugues sobrou
  expect(screen.queryByText("Entrar")).not.toBeInTheDocument();
  expect(screen.queryByText(/Manter conectado/)).not.toBeInTheDocument();
});

it("o menu lateral aparece em ingles, com a navegacao e todos os itens", async () => {
  await i18n.changeLanguage("en");
  render(
    <MemoryRouter>
      <SidebarNav />
    </MemoryRouter>,
  );
  expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
  for (const label of ["Dashboard", "Accounts", "Transactions", "Import statement", "Reconcile", "Categories", "Budgets", "Envelopes", "Bills", "Recurring", "Piggy banks", "Rules", "Webhooks", "Reports"]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  }
  expect(screen.queryByRole("link", { name: "Painel" })).not.toBeInTheDocument();
});

it("a validacao compartilhada fala o idioma da hora (e interpola o minimo)", async () => {
  const { passwordError, emailError } = await import("@/auth/validation");
  await i18n.changeLanguage("en");
  expect(emailError("")).toBe("Enter your email.");
  expect(emailError("x")).toBe("Enter a valid email.");
  expect(passwordError("abc")).toBe("Password must be at least 8 characters.");
  await i18n.changeLanguage("pt-BR");
  expect(emailError("")).toBe("Informe o e-mail.");
  expect(passwordError("abc")).toBe("A senha precisa ter pelo menos 8 caracteres.");
});
