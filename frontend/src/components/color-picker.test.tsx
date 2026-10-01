import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { ColorPicker } from "./color-picker";

function Harness({ initial = "", onChange }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ColorPicker
      id="cor"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const textField = () => screen.getByRole("textbox");
const nativePicker = () => screen.getByLabelText("Escolher a cor no seletor") as HTMLInputElement;

it("mostra o codigo digitado e o seletor acompanha", async () => {
  render(<Harness />);
  await userEvent.type(textField(), "#00a878");
  expect(textField()).toHaveValue("#00a878");
  expect(nativePicker().value).toBe("#00a878");
});

it("aceita o codigo sem o # e na forma curta", async () => {
  render(<Harness />);
  await userEvent.type(textField(), "fff");
  expect(nativePicker().value).toBe("#ffffff");
});

it("enquanto o texto nao e uma cor valida, o seletor mostra um cinza neutro", async () => {
  render(<Harness />);
  await userEvent.type(textField(), "#12");
  expect(nativePicker().value).toBe("#808080");
});

it("escolher no seletor do navegador preenche o texto em maiusculas", () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  fireEvent.change(nativePicker(), { target: { value: "#ff8800" } });
  expect(onChange).toHaveBeenCalledWith("#FF8800");
  expect(textField()).toHaveValue("#FF8800");
});

it("clicar numa amostra usa a cor dela", async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Usar a cor #00A878" }));
  expect(textField()).toHaveValue("#00A878");
  expect(screen.getByRole("button", { name: "Usar a cor #00A878" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Usar a cor #1E3A6B" })).toHaveAttribute("aria-pressed", "false");
});

it("a amostra aparece marcada tambem quando a cor foi digitada em minusculas", async () => {
  render(<Harness />);
  await userEvent.type(textField(), "#e11d48");
  expect(screen.getByRole("button", { name: "Usar a cor #E11D48" })).toHaveAttribute("aria-pressed", "true");
});

it("as amostras sao so sugestao: qualquer outra cor pode ser digitada", async () => {
  render(<Harness />);
  await userEvent.type(textField(), "#123456");
  const pressed = screen.queryAllByRole("button", { pressed: true });
  expect(pressed).toHaveLength(0);
  expect(nativePicker().value).toBe("#123456");
});

it("Sem cor limpa o campo e fica desabilitado quando ja esta vazio", async () => {
  render(<Harness initial="#00A878" />);
  const clear = screen.getByRole("button", { name: "Sem cor" });
  expect(clear).toBeEnabled();
  await userEvent.click(clear);
  expect(textField()).toHaveValue("");
  expect(clear).toBeDisabled();
});

it("repassa os atributos de acessibilidade para o campo de texto", () => {
  render(<ColorPicker id="cor" value="x" onChange={() => undefined} aria-invalid aria-describedby="erro" />);
  expect(textField()).toHaveAttribute("id", "cor");
  expect(textField()).toHaveAttribute("aria-invalid", "true");
  expect(textField()).toHaveAttribute("aria-describedby", "erro");
});

it("agrupa as sugestoes com um nome para leitor de tela", () => {
  render(<Harness />);
  expect(screen.getByRole("group", { name: "Cores sugeridas" })).toBeInTheDocument();
  // As tres primeiras sugestoes sao a paleta do app
  const swatches = screen.getAllByRole("button", { name: /^Usar a cor/ });
  expect(swatches.slice(0, 3).map((b) => b.getAttribute("aria-label"))).toEqual([
    "Usar a cor #1E3A6B",
    "Usar a cor #00A878",
    "Usar a cor #01603B",
  ]);
});
