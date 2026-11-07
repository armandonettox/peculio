import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { makeTransaction } from "@/test-utils/transaction-fixtures";
import { TransactionRow } from "./transaction-row";

function renderRow(splits: Parameters<typeof makeTransaction>[1], onSettle: () => void = () => undefined) {
  render(
    <ul>
      <TransactionRow
        transaction={makeTransaction({}, splits)}
        categories={new Map()}
        tags={new Map()}
        onEdit={() => undefined}
        onRemove={() => undefined}
        onAttachments={() => undefined}
        onSettle={onSettle}
      />
    </ul>,
  );
}

it("sem conferencia nao mostra marca", () => {
  renderRow([{}]);
  expect(screen.queryByText("Conferido")).not.toBeInTheDocument();
  expect(screen.queryByText("Conciliado")).not.toBeInTheDocument();
});

it("conferido mostra a marca simples", () => {
  renderRow([{ cleared: true }]);
  expect(screen.getByText("Conferido")).toBeInTheDocument();
  expect(screen.queryByText("Conciliado")).not.toBeInTheDocument();
});

it("travado mostra que foi conciliado", () => {
  renderRow([{ cleared: true, locked: true }]);
  expect(screen.getByText("Conciliado")).toBeInTheDocument();
  expect(screen.queryByText("Conferido")).not.toBeInTheDocument();
});

it("pago e nao ignorado nao mostra selo nem a acao de efetivar", async () => {
  renderRow([{}]);
  expect(screen.queryByText("Não paga")).not.toBeInTheDocument();
  expect(screen.queryByText("Ignorada")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Ações/ }));
  expect(screen.queryByRole("menuitem", { name: "Efetivar" })).not.toBeInTheDocument();
});

it("saida nao paga mostra o selo e oferece efetivar", async () => {
  const onSettle = vi.fn();
  renderRow([{ is_paid: false }], onSettle);
  expect(screen.getByText("Não paga")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Ações/ }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Efetivar" }));
  expect(onSettle).toHaveBeenCalledTimes(1);
});

it("entrada nao paga diz nao recebida", () => {
  renderRow([{ type: "deposit", is_paid: false }]);
  expect(screen.getByText("Não recebida")).toBeInTheDocument();
});

it("ignorada mostra o selo e continua sem pedir para efetivar", async () => {
  renderRow([{ ignored: true }]);
  expect(screen.getByText("Ignorada")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Ações/ }));
  expect(screen.queryByRole("menuitem", { name: "Efetivar" })).not.toBeInTheDocument();
});
