import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it } from "vitest";

import { readLayout } from "@/features/dashboard/cards";
import { DashboardSection } from "./dashboard-section";

// O jsdom nao tem matchMedia: o teste diz se a tela e larga (duas colunas) ou de celular (lista unica)
function setScreen(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  setScreen(true);
});
afterEach(() => {
  // @ts-expect-error o jsdom nao tem elementFromPoint: o teste o define e aqui some de novo
  delete document.elementFromPoint;
});

// O jsdom nao calcula posicao: o teste diz qual elemento esta sob o ponteiro
function pointerOver(element: Element) {
  document.elementFromPoint = () => element;
}

const left = () => screen.getByRole("group", { name: "Coluna da esquerda" });
const right = () => screen.getByRole("group", { name: "Coluna da direita" });
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
  window.localStorage.setItem("peculio.dashboard.layout", JSON.stringify({ enabled: ["profile"], left: [], right: [] }));
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
  expect(readLayout().left.slice(0, 2)).toEqual(["spendingFrequency", "expensesByCategory"]);
});

it("arrastar a linha com o mouse leva ela para o lugar da outra, e soltar nao liga nem desliga o bloco", () => {
  render(<DashboardSection />);
  const rows = within(left()).getAllByRole("listitem");
  const first = rows[0];
  pointerOver(rows[2]);

  fireEvent.pointerDown(first, { pointerId: 1, pointerType: "mouse" });
  fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 200 });
  fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });
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
  fireEvent.pointerMove(window, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 200 });
  expect(rowNames(left())[0]).toBe("Gráfico de despesas por categoria");
});

it("arrastar a linha para a outra coluna passa o bloco para la, no lugar da linha alvo", () => {
  render(<DashboardSection />);
  const target = within(right()).getAllByRole("listitem")[1];
  const first = within(left()).getAllByRole("listitem")[0];
  pointerOver(target);
  fireEvent.pointerDown(first, { pointerId: 1, pointerType: "mouse" });
  fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientX: 600, clientY: 100 });
  fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });

  expect(rowNames(left())).not.toContain("Gráfico de despesas por categoria");
  expect(rowNames(right()).slice(0, 3)).toEqual([
    "Gráfico de receitas por categoria",
    "Gráfico de despesas por categoria",
    "Gráfico do balanço semestral",
  ]);
});

it("soltar sobre a coluna fora de qualquer linha leva o bloco para o fim dela", () => {
  render(<DashboardSection />);
  const first = within(left()).getAllByRole("listitem")[0];
  pointerOver(right().querySelector("ul") as Element);
  fireEvent.pointerDown(first, { pointerId: 1, pointerType: "mouse" });
  fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientX: 600, clientY: 900 });
  fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });

  expect(rowNames(right()).at(-1)).toBe("Gráfico de despesas por categoria");
});

it("o botao de mover para a outra coluna faz o mesmo pelo teclado, e so salvar grava", async () => {
  render(<DashboardSection />);
  await userEvent.click(screen.getByRole("button", { name: "Mover Informações de perfil para a coluna da esquerda" }));
  expect(rowNames(left()).at(-1)).toBe("Informações de perfil");
  expect(rowNames(right())).not.toContain("Informações de perfil");

  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(readLayout().left.at(-1)).toBe("profile");
  expect(readLayout().right).not.toContain("profile");
});

// ---------- Celular: uma lista so ----------

const flatRows = () => within(screen.getByRole("group", { name: "Blocos do painel" })).getAllByRole("listitem");
const flatNames = () => flatRows().map((row) => row.textContent);

it("no celular nao ha colunas: uma lista so, a da esquerda e depois a da direita, sem botao de coluna", () => {
  setScreen(false);
  render(<DashboardSection />);
  expect(screen.queryByRole("group", { name: "Coluna da esquerda" })).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Coluna da direita" })).not.toBeInTheDocument();
  const names = flatNames();
  expect(names[0]).toBe("Gráfico de despesas por categoria");
  // O primeiro bloco da coluna da direita vem logo depois do ultimo da esquerda
  expect(names[10]).toBe("Gráfico de receitas por categoria");
  expect(screen.queryByRole("button", { name: /para a coluna/ })).not.toBeInTheDocument();
  expect(screen.getByText(/uma coluna só/)).toBeInTheDocument();
});

it("no celular as setas andam pela lista inteira, passando de uma coluna para a outra sem pular posicao", async () => {
  setScreen(false);
  render(<DashboardSection />);
  const lastOfLeft = "Últimas transações";
  await userEvent.click(screen.getByRole("button", { name: `Descer ${lastOfLeft}` }));
  const names = flatNames();
  expect(names[9]).toBe("Gráfico de receitas por categoria");
  expect(names[10]).toBe(lastOfLeft);

  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
  // Na tela larga a divisao tem o mesmo tamanho: os primeiros 10 ficam na esquerda
  expect(readLayout().left).toHaveLength(10);
  expect(readLayout().left.at(-1)).toBe("incomeByCategory");
});

it("no celular arrastar reordena a lista e o fim da lista recebe o bloco solto abaixo do ultimo", () => {
  setScreen(false);
  render(<DashboardSection />);
  const rows = flatRows();
  pointerOver(rows[3]);
  fireEvent.pointerDown(rows[0], { pointerId: 1, pointerType: "mouse" });
  fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 100 });
  fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });
  expect(flatNames().slice(0, 4)).toEqual([
    "Gráfico de frequência de gastos",
    "Balanço mensal",
    "Transações pendentes",
    "Gráfico de despesas por categoria",
  ]);

  pointerOver(screen.getByRole("group", { name: "Blocos do painel" }).querySelector("ul") as Element);
  fireEvent.pointerDown(flatRows()[0], { pointerId: 1, pointerType: "mouse" });
  fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 900 });
  fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });
  expect(flatNames().at(-1)).toBe("Gráfico de frequência de gastos");
});
