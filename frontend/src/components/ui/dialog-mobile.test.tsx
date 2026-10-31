import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./dialog";

function renderDialog(fullOnMobile?: boolean) {
  render(
    <Dialog open>
      <DialogContent fullOnMobile={fullOnMobile}>
        <DialogTitle>Titulo</DialogTitle>
        <DialogFooter>
          <button type="button">Cancelar</button>
          <button type="submit">Salvar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
  return screen.getByRole("dialog");
}

it("por padrao a janela continua centralizada, sem o modo tela cheia", () => {
  const dialog = renderDialog();
  expect(dialog).not.toHaveAttribute("data-full-mobile");
  expect(dialog.className).not.toContain("max-sm:h-dvh");
});

it("fullOnMobile marca a janela e ocupa a tela toda so em tela pequena", () => {
  const dialog = renderDialog(true);
  expect(dialog).toHaveAttribute("data-full-mobile");
  expect(dialog.className).toContain("max-sm:h-dvh");
  expect(dialog.className).toContain("max-sm:w-full");
  expect(dialog.className).toContain("max-sm:translate-x-0");
  // Do tamanho sm para cima o tamanho e a posicao de antes seguem valendo
  expect(dialog.className).toContain("max-w-lg");
  expect(dialog.className).toContain("-translate-x-1/2");
});

it("o rodape fixo depende da marca da janela, entao so vale em janela fullOnMobile", () => {
  renderDialog(true);
  const footer = screen.getByRole("button", { name: "Salvar" }).parentElement;
  expect(footer?.className).toContain("group-data-[full-mobile]/dialog:max-sm:sticky");
  expect(footer?.className).toContain("group-data-[full-mobile]/dialog:max-sm:bottom-0");
});

it("a janela nao rola para os lados", () => {
  expect(renderDialog().className).toContain("overflow-x-hidden");
});
