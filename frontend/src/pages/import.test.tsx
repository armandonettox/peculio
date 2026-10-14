import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeImportsApi } from "@/test-utils/imports-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeReconciliationApi } from "@/test-utils/reconciliation-api";
import ImportReconciliationPage from "./import";

// A pagina e em abas (Importar extrato, Conciliar); por padrao abre em Importar extrato
function renderPage() {
  server.use(
    ...fakeImportsApi([]).handlers,
    ...fakeReconciliationApi([]).handlers,
    ...fakeAccountsApi([makeAccount({ name: "Nubank" })]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <ImportReconciliationPage />
      </MemoryRouter>
    </FakeAuth>,
  );
}

it("a pagina tem as duas abas, Importar extrato ja aberta", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1, name: "Importar e conciliar" })).toBeInTheDocument();
  for (const title of ["Importar extrato", "Conciliar"]) expect(screen.getByRole("tab", { name: title })).toBeInTheDocument();
  expect(await screen.findByText("Traga os lançamentos de um extrato do banco (CSV ou OFX)")).toBeInTheDocument();
  expect(screen.getByLabelText("Conta que recebe o extrato")).toBeInTheDocument();
});

it("clicar na aba Conciliar troca o conteudo, mantendo o h1 da pagina", async () => {
  renderPage();
  await screen.findByLabelText("Conta que recebe o extrato");
  await userEvent.click(screen.getByRole("tab", { name: "Conciliar" }));
  expect(await screen.findByText(/Confira os lançamentos da conta com o extrato do banco/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Importar e conciliar" })).toBeInTheDocument();
  expect(screen.queryByText("Traga os lançamentos de um extrato do banco (CSV ou OFX)")).not.toBeInTheDocument();
});
