import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeLabelsApi } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeRecurrencesApi, makeRecurrence } from "@/test-utils/recurrences-api";
import { RecurrenceManageDialog } from "./recurrence-manage-dialog";

function setup(recurrence = makeRecurrence({ name: "Aluguel", max_occurrences: null, created_count: 3 })) {
  const api = fakeRecurrencesApi([recurrence]);
  const onClose = vi.fn();
  server.use(...api.handlers, ...fakeAccountsApi([makeAccount()]).handlers, ...fakeLabelsApi("categories", []).handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <RecurrenceManageDialog recurrenceId={recurrence.id} onClose={onClose} />
      </MemoryRouter>
    </FakeAuth>,
  );
  return { api, onClose, recurrence };
}

it("mostra o nome, a frequencia, o proximo lancamento e o fim da recorrencia", async () => {
  setup();
  const dialog = await screen.findByRole("dialog", { name: "Aluguel" });
  expect(within(dialog).getByText("Automática")).toBeInTheDocument();
  expect(within(dialog).getByText(/Mensal/)).toBeInTheDocument();
  expect(within(dialog).getByText(/Próximo/)).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Editar" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Pausar" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Excluir" })).toBeInTheDocument();
});

it("pausar manda active false e o botao vira Retomar, com o aviso do periodo parado", async () => {
  const { api } = setup();
  await userEvent.click(await screen.findByRole("button", { name: "Pausar" }));

  expect(await screen.findByRole("button", { name: "Retomar" })).toBeInTheDocument();
  expect(api.mutations()[0]).toMatchObject({ method: "PATCH", body: { active: false } });
  expect(screen.getAllByText("Pausada").length).toBeGreaterThan(0);
  expect(screen.getByText(/o período parado não é recriado/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Retomar" }));
  expect(await screen.findByRole("button", { name: "Pausar" })).toBeInTheDocument();
  expect(api.mutations()[1]).toMatchObject({ body: { active: true } });
});

it("uma recorrencia que terminou nao pode ser pausada nem retomada", async () => {
  setup(makeRecurrence({ name: "Parcelas", max_occurrences: 3, created_count: 3, next_date: null, ended: true }));
  await screen.findByRole("dialog", { name: "Parcelas" });
  expect(screen.getAllByText("Terminou").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Pausar" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retomar" })).not.toBeInTheDocument();
});

it("erro ao pausar aparece no dialogo e a recorrencia continua como estava", async () => {
  const { api } = setup();
  await screen.findByRole("button", { name: "Pausar" });
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await userEvent.click(screen.getByRole("button", { name: "Pausar" }));

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pausar" })).toBeInTheDocument();
});

it("Editar abre o formulario da recorrencia no lugar do resumo", async () => {
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
  expect(await screen.findByRole("dialog", { name: "Editar recorrente" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Aluguel" })).not.toBeInTheDocument();
});

it("excluir pede confirmacao, apaga a recorrencia e fecha tudo", async () => {
  const { api, onClose, recurrence } = setup();
  await userEvent.click(await screen.findByRole("button", { name: "Excluir" }));

  const confirm = await screen.findByRole("dialog", { name: "Excluir recorrente" });
  expect(within(confirm).getByText(/Aluguel/)).toBeInTheDocument();
  await userEvent.click(within(confirm).getByRole("button", { name: "Excluir" }));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(api.mutations()).toEqual([expect.objectContaining({ method: "DELETE", path: `/recurrences/${recurrence.id}` })]);
});

it("cancelar a exclusao volta ao resumo sem apagar nada", async () => {
  const { api, onClose } = setup();
  await userEvent.click(await screen.findByRole("button", { name: "Excluir" }));
  await userEvent.click(within(await screen.findByRole("dialog", { name: "Excluir recorrente" })).getByRole("button", { name: "Cancelar" }));

  expect(await screen.findByRole("dialog", { name: "Aluguel" })).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(api.mutations()).toHaveLength(0);
});

it("recorrencia que nao existe mais mostra o erro e deixa fechar", async () => {
  const api = fakeRecurrencesApi([]);
  const onClose = vi.fn();
  server.use(...api.handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <RecurrenceManageDialog recurrenceId="f0000000-0000-4000-8000-0000000000ff" onClose={onClose} />
      </MemoryRouter>
    </FakeAuth>,
  );
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Fechar" }));
  expect(onClose).toHaveBeenCalled();
});
