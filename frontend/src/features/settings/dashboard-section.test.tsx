import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";

import { readEnabledCards } from "@/features/dashboard/cards";
import { DashboardSection } from "./dashboard-section";

beforeEach(() => window.localStorage.clear());

it("mostra as duas colunas com os blocos padrao ligados", () => {
  render(<DashboardSection />);
  expect(screen.getByRole("group", { name: "Coluna da esquerda" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Coluna da direita" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Gráfico de despesas por categoria" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Calendário de movimentações" })).not.toBeChecked();
});

it("so grava a escolha ao salvar", async () => {
  render(<DashboardSection />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Calendário de movimentações" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Gráfico de despesas por categoria" }));
  expect(readEnabledCards()).toContain("expensesByCategory");

  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(screen.getByRole("status")).toHaveTextContent("Escolha salva.");
  expect(readEnabledCards()).toContain("calendar");
  expect(readEnabledCards()).not.toContain("expensesByCategory");
});

it("Restaurar o padrao volta as caixas, mas so vale depois de salvar", async () => {
  window.localStorage.setItem("peculio.dashboard.cards", JSON.stringify(["profile"]));
  render(<DashboardSection />);
  expect(screen.getByRole("checkbox", { name: "Informações de perfil" })).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Restaurar o padrão" }));
  expect(screen.getByRole("checkbox", { name: "Informações de perfil" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Gráfico de despesas por categoria" })).toBeChecked();
  expect(readEnabledCards()).toEqual(["profile"]);
});
