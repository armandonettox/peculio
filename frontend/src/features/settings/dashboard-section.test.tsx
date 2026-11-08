import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it } from "vitest";

import { orderedColumn, readLayout } from "@/features/dashboard/cards";
import { DashboardSection } from "./dashboard-section";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  // @ts-expect-error o jsdom nao tem elementFromPoint: o teste o define e aqui some de novo
  delete document.elementFromPoint;
});

// O jsdom nao calcula posicao: o teste diz qual elemento esta sob o ponteiro
function pointerOver(element: Element) {
  document.elementFromPoint = () => element;
}

const left = () => screen.getByRole("group", { name: "Coluna da esquerda" });
const rowNames = (group: HTMLElement) => within(group).getAllByRole("listitem").map((row) => row.textContent);

it("mostra as duas colunas com os blocos padrao ligados", () => {
  render(<DashboardSection />);
  expect(screen.getByRole("group", { name: "Coluna da direita" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Gráfico de despesas por categoria" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Calendário de movimentações" })).not.toBeChecked();
});

it("so grava a escolha ao salvar", async () => {
  render(<DashboardSection />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Calendário de movimentações" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Gráfico de despesas por categoria" }));
  expect(readLayout().enabled).toContain("expensesByCategory");

  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(screen.getByRole("status")).toHaveTextContent("Escolha salva.");
  expect(readLayout().enabled).toContain("calendar");
  expect(readLayout().enabled).not.toContain("expensesByCategory");
});

it("Restaurar o padrao volta as caixas e a ordem, mas so vale depois de salvar", async () => {
  window.localStorage.setItem("peculio.dashboard.layout", JSON.stringify({ enabled: ["profile"], order: [] }));
  render(<DashboardSection />);
  expect(screen.getByRole("checkbox", { name: "Informações de perfil" })).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Restaurar o padrão" }));
  expect(screen.getByRole("checkbox", { name: "Informações de perfil" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Gráfico de despesas por categoria" })).toBeChecked();
  expect(readLayout().enabled).toEqual(["profile"]);
});

it("as setas sobem e descem o bloco dentro da coluna, e so salvar grava a ordem", async () => {
  render(<DashboardSection />);
  expect(rowNames(left())[0]).toBe("Gráfico de despesas por categoria");
  await userEvent.click(screen.getByRole("button", { name: "Descer Gráfico de despesas por categoria" }));
  expect(rowNames(left()).slice(0, 2)).toEqual(["Gráfico de frequência de gastos", "Gráfico de despesas por categoria"]);
  expect(screen.getByRole("button", { name: "Subir Gráfico de frequência de gastos" })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(orderedColumn(readLayout().order, "left").slice(0, 2)).toEqual(["spendingFrequency", "expensesByCategory"]);
});

it("arrastar a linha com o mouse leva ela para o lugar da outra, e soltar nao liga nem desliga o bloco", () => {
  render(<DashboardSection />);
  const rows = within(left()).getAllByRole("listitem");
  const first = rows[0];
  pointerOver(rows[2]);

  fireEvent.pointerDown(first, { pointerId: 1, pointerType: "mouse" });
  fireEvent.pointerMove(first, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 200 });
  fireEvent.pointerUp(first, { pointerId: 1, pointerType: "mouse" });
  // O clique que o navegador dispara depois de soltar nao pode mudar a caixa
  const box = screen.getByRole("checkbox", { name: "Gráfico de despesas por categoria" });
  fireEvent.click(box.closest("label") as HTMLElement);

  expect(rowNames(left()).slice(0, 3)).toEqual([
    "Gráfico de frequência de gastos",
    "Balanço mensal",
    "Gráfico de despesas por categoria",
  ]);
  expect(box).toBeChecked();
});

it("no toque so a alca arrasta: tocar na linha nao mexe na ordem", () => {
  render(<DashboardSection />);
  const rows = within(left()).getAllByRole("listitem");
  pointerOver(rows[2]);
  fireEvent.pointerDown(rows[0], { pointerId: 1, pointerType: "touch" });
  fireEvent.pointerMove(rows[0], { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 200 });
  expect(rowNames(left())[0]).toBe("Gráfico de despesas por categoria");
});
