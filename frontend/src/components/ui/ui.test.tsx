import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";

it("botao chama o clique", async () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Salvar</Button>);
  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(onClick).toHaveBeenCalledOnce();
});

it("botao desabilitado nao dispara clique", async () => {
  const onClick = vi.fn();
  render(
    <Button onClick={onClick} disabled>
      Salvar
    </Button>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(onClick).not.toHaveBeenCalled();
});

it("botao com asChild vira o elemento filho (link)", () => {
  render(
    <Button asChild>
      <a href="/contas">Contas</a>
    </Button>,
  );
  expect(screen.getByRole("link", { name: "Contas" })).toHaveAttribute("href", "/contas");
});

it("label fica ligado ao campo pelo id", async () => {
  render(
    <>
      <Label htmlFor="email">Email</Label>
      <Input id="email" />
    </>,
  );
  await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
  expect(screen.getByLabelText("Email")).toHaveValue("ana@example.com");
});

it("campo marcado como invalido recebe o atributo de acessibilidade", () => {
  render(<Input aria-label="Senha" aria-invalid="true" />);
  expect(screen.getByLabelText("Senha")).toHaveAttribute("aria-invalid", "true");
});
