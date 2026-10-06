import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

// Como as telas usam: um botao muda o estado e o dialogo e montado (sem DialogTrigger)
function Page() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <button>Outro botao</button>
      {open && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent>
            <DialogTitle>Titulo</DialogTitle>
            <DialogDescription>Descricao</DialogDescription>
            <input aria-label="Campo" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

it("fechar com Esc devolve o foco ao botao que abriu", async () => {
  const user = userEvent.setup();
  render(<Page />);
  const opener = screen.getByRole("button", { name: "Abrir" });
  opener.focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("dialog")).toBeInTheDocument();

  await user.keyboard("{Escape}");

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
});

it("fechar pelo botao Fechar tambem devolve o foco", async () => {
  const user = userEvent.setup();
  render(<Page />);
  const opener = screen.getByRole("button", { name: "Abrir" });
  await user.click(opener);
  await user.click(await screen.findByRole("button", { name: "Fechar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
});

it("devolve o foco ao ultimo elemento de fora, nao a outro botao qualquer", async () => {
  const user = userEvent.setup();
  render(<Page />);
  await user.click(screen.getByRole("button", { name: "Outro botao" }));
  const opener = screen.getByRole("button", { name: "Abrir" });
  await user.click(opener);
  await screen.findByRole("dialog");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(opener).toHaveFocus());
});
