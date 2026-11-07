import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ChipSelect, type ChipOption } from "./chip-select";

const options: ChipOption[] = [
  { value: "", label: "Sem categoria" },
  { value: "a", label: "Alimentação", leading: <span data-testid="icon-a" /> },
  { value: "b", label: "Casa" },
  { value: "c", label: "Carro", hint: "Veículos" },
];

function Harness({ onClose = () => undefined, start = "" }: { onClose?: () => void; start?: string }) {
  const [value, setValue] = useState(start);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Titulo</DialogTitle>
        <DialogDescription>Descricao</DialogDescription>
        <label htmlFor="cat">Categoria</label>
        <ChipSelect id="cat" value={value} options={options} placeholder="Escolha" onChange={setValue} />
        <output data-testid="valor">{value}</output>
      </DialogContent>
    </Dialog>
  );
}

const combo = () => screen.getByRole("combobox", { name: "Categoria" });

it("mostra o escolhido como chip e o nome liga ao botao pelo rotulo", () => {
  render(<Harness start="a" />);
  expect(combo()).toHaveTextContent("Alimentação");
  expect(screen.getByTestId("icon-a")).toBeInTheDocument();
  expect(combo()).toHaveAttribute("aria-expanded", "false");
});

it("abre a lista, escolhe com o mouse e fecha devolvendo o foco ao botao", async () => {
  render(<Harness />);
  await userEvent.click(combo());
  expect(combo()).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByRole("option")).toHaveLength(4);
  await userEvent.click(screen.getByRole("option", { name: "Casa" }));
  expect(screen.getByTestId("valor")).toHaveTextContent("b");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(combo()).toHaveFocus();
});

it("a busca filtra ignorando acento e maiuscula, e olha tambem o texto de apoio", async () => {
  render(<Harness />);
  await userEvent.click(combo());
  await userEvent.type(screen.getByRole("searchbox"), "alimentacao");
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Alimentação"]);
  await userEvent.clear(screen.getByRole("searchbox"));
  await userEvent.type(screen.getByRole("searchbox"), "veiculos");
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["CarroVeículos"]);
});

it("sem resultado mostra Nada encontrado", async () => {
  render(<Harness />);
  await userEvent.click(combo());
  await userEvent.type(screen.getByRole("searchbox"), "zzz");
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByText("Nada encontrado")).toBeInTheDocument();
});

it("setas e Enter escolhem sem o mouse, e Enter nao envia nenhum formulario", async () => {
  render(<Harness />);
  await userEvent.click(combo());
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  expect(screen.getByTestId("valor")).toHaveTextContent("b");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("a lista abre com a opcao atual em destaque", async () => {
  render(<Harness start="b" />);
  await userEvent.click(combo());
  expect(screen.getByRole("option", { name: "Casa" })).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Enter}");
  expect(screen.getByTestId("valor")).toHaveTextContent("b");
});

it("Esc fecha so a lista; o dialogo continua aberto, e um segundo Esc fecha o dialogo", async () => {
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  await userEvent.click(combo());
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("clicar fora fecha a lista sem mudar o valor", async () => {
  render(<Harness start="a" />);
  await userEvent.click(combo());
  await userEvent.click(screen.getByText("Descricao"));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(screen.getByTestId("valor")).toHaveTextContent("a");
});

it("valor que nao esta nas opcoes mostra o texto de apoio", () => {
  render(<Harness start="x" />);
  expect(combo()).toHaveTextContent("Escolha");
});
