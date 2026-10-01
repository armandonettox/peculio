import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import TagsPage from "./tags";

function renderPage(initial = [makeLabel({ name: "viagem" })]) {
  const api = fakeLabelsApi("tags", initial);
  server.use(...api.handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <TagsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const dialog = () => screen.getByRole("dialog");
const nameField = () => within(dialog()).getByLabelText("Nome");
const openMenu = (name: string) => userEvent.click(screen.getByRole("button", { name: `Ações de ${name}` }));

it("lista as tags em ordem alfabetica, sem cor", async () => {
  renderPage([makeLabel({ name: "reembolso" }), makeLabel({ name: "Viagem" }), makeLabel({ name: "casa" })]);
  await screen.findByText("casa");
  expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["casa", "reembolso", "Viagem"]);
  expect(screen.getByText("3 tags")).toBeInTheDocument();
  expect(screen.getByText("casa")).not.toHaveAttribute("data-color");
});

it("sem tags mostra o estado vazio", async () => {
  renderPage([]);
  expect(await screen.findByText("Nenhuma tag ainda")).toBeInTheDocument();
});

it("o formulario de tag nao tem escolha de cor", async () => {
  renderPage();
  await screen.findByText("viagem");
  await userEvent.click(screen.getAllByRole("button", { name: "Nova tag" })[0]);
  expect(dialog()).toHaveAccessibleName("Nova tag");
  expect(within(dialog()).queryByLabelText("Cor")).not.toBeInTheDocument();
  expect(within(dialog()).queryByRole("group", { name: "Cores sugeridas" })).not.toBeInTheDocument();
  expect(nameField()).toHaveAttribute("maxlength", "50");
});

it("cria uma tag enviando so o nome", async () => {
  const api = renderPage();
  await screen.findByText("viagem");
  await userEvent.click(screen.getAllByRole("button", { name: "Nova tag" })[0]);
  await userEvent.type(nameField(), "  reembolso  ");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));

  expect(await screen.findByText("reembolso")).toBeInTheDocument();
  expect(api.mutations()[0].body).toEqual({ name: "reembolso" });
});

it("nome vazio nao chama a API", async () => {
  const api = renderPage();
  await screen.findByText("viagem");
  await userEvent.click(screen.getAllByRole("button", { name: "Nova tag" })[0]);
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  expect(within(dialog()).getByText("Informe o nome.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("nome repetido aparece no campo, ignorando maiusculas", async () => {
  renderPage();
  await screen.findByText("viagem");
  await userEvent.click(screen.getAllByRole("button", { name: "Nova tag" })[0]);
  await userEvent.type(nameField(), "VIAGEM");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  expect(await within(dialog()).findByText("Já existe uma tag com esse nome.")).toBeInTheDocument();
});

it("renomear envia so o nome e mantem a lista ordenada", async () => {
  const api = renderPage([makeLabel({ name: "b" }), makeLabel({ name: "c" })]);
  await screen.findByText("b");
  await openMenu("b");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.clear(nameField());
  await userEvent.type(nameField(), "d");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["c", "d"]));
  expect(api.mutations()[0].body).toEqual({ name: "d" });
});

it("salvar sem mudar nada nao chama a API", async () => {
  const api = renderPage();
  await screen.findByText("viagem");
  await openMenu("viagem");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  expect(api.mutations()).toHaveLength(0);
});

it("busca filtra as tags", async () => {
  const api = renderPage([makeLabel({ name: "viagem" }), makeLabel({ name: "reembolso" })]);
  await screen.findByText("viagem");
  await userEvent.type(screen.getByLabelText("Buscar tag"), "reem");
  await waitFor(() => expect(api.lastSearch()).toBe("reem"));
  expect(screen.queryByText("viagem")).not.toBeInTheDocument();
  expect(screen.getByText("reembolso")).toBeInTheDocument();
});

it("excluir explica que a tag sai das transacoes e remove", async () => {
  const api = renderPage();
  await screen.findByText("viagem");
  await openMenu("viagem");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  expect(within(dialog()).getByText(/Ela será removida das transações que a usam/)).toBeInTheDocument();
  await userEvent.click(within(dialog()).getByRole("button", { name: "Excluir" }));
  expect(await screen.findByText("Nenhuma tag ainda")).toBeInTheDocument();
  expect(api.mutations()[0].method).toBe("DELETE");
});
