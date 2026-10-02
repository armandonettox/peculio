import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import type { Transaction } from "@/api/transactions";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeAttachmentsApi, makeAttachment } from "@/test-utils/attachments-api";
import { fakeLabelsApi } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { makeTransaction } from "@/test-utils/transaction-fixtures";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import TransactionsPage from "./transactions";

const nubank = makeAccount({ id: "a0000000-0000-4000-8000-000000000001", name: "Nubank" });

function renderPage(transactions: Transaction[], attachments = [] as ReturnType<typeof makeAttachment>[]) {
  const tx = fakeTransactionsApi(transactions);
  const files = fakeAttachmentsApi(attachments, {
    // Como no backend: o numero de anexos da lista acompanha o que foi enviado ou excluido
    onCountChange: (transactionId, count) => {
      tx.state.items = tx.state.items.map((item) =>
        item.id === transactionId ? { ...item, attachment_count: count } : item,
      );
    },
  });
  server.use(
    tx.handler,
    ...files.handlers,
    ...fakeAccountsApi([nubank]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter initialEntries={["/transacoes"]}>
        <TransactionsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return { tx, files };
}

const withFiles = (description: string, count: number) =>
  makeTransaction({ attachment_count: count }, [{ description }]);

const rowOf = (text: string) => screen.getByText(text, { selector: "p" }).closest("li") as HTMLElement;

it("a linha mostra o clipe com a contagem so quando ha anexos", async () => {
  renderPage([withFiles("Com anexos", 3), withFiles("Sem anexos", 0), withFiles("Com um", 1)]);
  await screen.findByText("Com anexos");

  const three = within(rowOf("Com anexos")).getByRole("button", { name: /^3 anexos, abrir anexos de Com anexos/ });
  expect(three).toHaveTextContent("3");
  expect(within(rowOf("Com um")).getByRole("button", { name: /^1 anexo, abrir anexos/ })).toHaveTextContent("1");
  expect(within(rowOf("Sem anexos")).queryByRole("button", { name: /^\d+ anexos?,/ })).not.toBeInTheDocument();
});

it("o item Anexos do menu abre o dialogo mesmo sem anexos", async () => {
  renderPage([withFiles("Compra", 0)]);
  await screen.findByText("Compra");

  await userEvent.click(screen.getByRole("button", { name: "Ações do lançamento Compra" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Anexos" }));

  const dialog = await screen.findByRole("dialog", { name: "Anexos" });
  expect(await within(dialog).findByText(/Nenhum anexo ainda/)).toBeInTheDocument();
});

it("o clipe abre o dialogo com os arquivos do lancamento certo", async () => {
  const first = withFiles("Primeira", 1);
  const second = withFiles("Segunda", 1);
  renderPage(
    [first, second],
    [
      makeAttachment({ transaction_id: first.id, original_name: "da-primeira.pdf" }),
      makeAttachment({ transaction_id: second.id, original_name: "da-segunda.pdf" }),
    ],
  );
  await screen.findByText("Primeira");

  await userEvent.click(within(rowOf("Segunda")).getByRole("button", { name: /anexo/ }));

  const dialog = await screen.findByRole("dialog", { name: "Anexos" });
  expect(await within(dialog).findByText("da-segunda.pdf")).toBeInTheDocument();
  expect(within(dialog).queryByText("da-primeira.pdf")).not.toBeInTheDocument();
});

it("enviar um arquivo atualiza a contagem na linha", async () => {
  const { files } = renderPage([withFiles("Compra", 0)]);
  files.state.uploadedName = "recibo.pdf";
  await screen.findByText("Compra");

  await userEvent.click(screen.getByRole("button", { name: "Ações do lançamento Compra" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Anexos" }));
  const dialog = await screen.findByRole("dialog", { name: "Anexos" });
  await within(dialog).findByText(/Nenhum anexo ainda/);

  await userEvent.upload(
    within(dialog).getByLabelText("Escolher arquivo"),
    new File(["%PDF-1.4"], "recibo.pdf", { type: "application/pdf" }),
  );
  expect(await within(dialog).findByText("recibo.pdf")).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await within(rowOf("Compra")).findByRole("button", { name: /^1 anexo,/ })).toBeInTheDocument();
});

it("excluir o ultimo arquivo some com o clipe da linha", async () => {
  const transaction = withFiles("Compra", 1);
  renderPage([transaction], [makeAttachment({ transaction_id: transaction.id, original_name: "unico.pdf" })]);
  await screen.findByText("Compra");

  await userEvent.click(within(rowOf("Compra")).getByRole("button", { name: /^1 anexo,/ }));
  const dialog = await screen.findByRole("dialog", { name: "Anexos" });
  await userEvent.click(await within(dialog).findByRole("button", { name: "Excluir unico.pdf" }));
  await userEvent.click(
    within(await screen.findByRole("dialog", { name: "Excluir anexo" })).getByRole("button", { name: "Excluir" }),
  );

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Excluir anexo" })).not.toBeInTheDocument());
  await userEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
  await waitFor(() => expect(within(rowOf("Compra")).queryByRole("button", { name: /^\d+ anexos?,/ })).not.toBeInTheDocument());
});

it("o dialogo de anexos nao envia nada sozinho ao abrir", async () => {
  const { files } = renderPage([withFiles("Compra", 0)]);
  const spy = vi.spyOn(FormData.prototype, "append");
  await screen.findByText("Compra");
  await userEvent.click(screen.getByRole("button", { name: "Ações do lançamento Compra" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Anexos" }));
  await screen.findByText(/Nenhum anexo ainda/);
  expect(files.writes()).toHaveLength(0);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
