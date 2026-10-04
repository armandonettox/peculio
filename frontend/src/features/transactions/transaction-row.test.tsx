import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { makeTransaction } from "@/test-utils/transaction-fixtures";
import { TransactionRow } from "./transaction-row";

function renderRow(splits: Parameters<typeof makeTransaction>[1]) {
  render(
    <ul>
      <TransactionRow
        transaction={makeTransaction({}, splits)}
        categories={new Map()}
        tags={new Map()}
        onEdit={() => undefined}
        onRemove={() => undefined}
        onAttachments={() => undefined}
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
