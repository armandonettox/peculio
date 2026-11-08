import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";

import { MonthPicker } from "./month-picker";

function Harness({ initial = "2026-11-01" }: { initial?: string }) {
  const [month, setMonth] = useState(initial);
  return (
    <>
      <MonthPicker value={month} currentMonth="2026-11-01" onChange={setMonth} />
      <p data-testid="chosen">{month}</p>
    </>
  );
}

it("mostra o mes escolhido e abre a grade de 12 meses no ano dele", async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: /Novembro de 2026/ }));
  const dialog = screen.getByRole("dialog", { name: "Escolher o mês" });
  expect(dialog).toHaveTextContent("2026");
  expect(screen.getAllByRole("button", { pressed: false }).length).toBe(11);
  expect(screen.getByRole("button", { pressed: true })).toHaveTextContent(/nov/i);
});

it("escolher um mes fecha a grade e avisa quem chamou", async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: /Novembro de 2026/ }));
  await userEvent.click(screen.getByRole("button", { name: /^mar/i }));
  expect(screen.getByTestId("chosen")).toHaveTextContent("2026-03-01");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("as setas trocam o ano da grade e o mes fica no ano novo", async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: /Novembro de 2026/ }));
  await userEvent.click(screen.getByRole("button", { name: "Ano anterior" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("2025");
  await userEvent.click(screen.getByRole("button", { name: /^jan/i }));
  expect(screen.getByTestId("chosen")).toHaveTextContent("2025-01-01");
});

it("Mes atual volta para o mes de hoje e Cancelar nao muda nada", async () => {
  render(<Harness initial="2025-06-01" />);
  await userEvent.click(screen.getByRole("button", { name: /Junho de 2025/ }));
  await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.getByTestId("chosen")).toHaveTextContent("2025-06-01");
  await userEvent.click(screen.getByRole("button", { name: /Junho de 2025/ }));
  await userEvent.click(screen.getByRole("button", { name: "Mês atual" }));
  expect(screen.getByTestId("chosen")).toHaveTextContent("2026-11-01");
});

it("Esc fecha a grade sem mudar o mes", async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: /Novembro de 2026/ }));
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByTestId("chosen")).toHaveTextContent("2026-11-01");
});
