import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { contrastRatio, normalizeHex } from "@/lib/color";
import { LabelChip } from "./label-chip";

// O navegador devolve a cor como rgb(...); converte para comparar com o hex
function toHex(rgb: string): string {
  const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

it("mostra o nome", () => {
  render(<LabelChip name="Mercado" />);
  expect(screen.getByText("Mercado")).toBeInTheDocument();
});

it("sem cor fica neutro", () => {
  render(<LabelChip name="Mercado" color={null} />);
  const chip = screen.getByText("Mercado");
  expect(chip).toHaveClass("bg-muted");
  expect(chip).not.toHaveAttribute("data-color");
});

it("com cor usa a cor de fundo", () => {
  render(<LabelChip name="Lazer" color="#00A878" />);
  expect(toHex(getComputedStyle(screen.getByText("Lazer")).backgroundColor)).toBe("#00A878");
});

it.each(["#FFFFFF", "#000000", "#FFFF00", "#1E3A6B", "#808080", "#FF0000", "#0000FF"])(
  "o texto fica legivel sobre %s",
  (color) => {
    render(<LabelChip name="Teste" color={color} />);
    const style = getComputedStyle(screen.getByText("Teste"));
    expect(contrastRatio(toHex(style.backgroundColor), toHex(style.color))).toBeGreaterThanOrEqual(4.5);
  },
);

it("aceita a cor em minusculas e na forma curta", () => {
  render(<LabelChip name="Teste" color="#abc" />);
  expect(screen.getByText("Teste")).toHaveAttribute("data-color", normalizeHex("#abc"));
});

it("cor invalida e tratada como sem cor, sem quebrar", () => {
  render(<LabelChip name="Teste" color="azul" />);
  expect(screen.getByText("Teste")).toHaveClass("bg-muted");
});

it("sempre tem contorno, para a cor nao sumir no fundo da tela", () => {
  render(<LabelChip name="Teste" color="#FFFFFF" />);
  expect(screen.getByText("Teste")).toHaveClass("border");
});
