import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeAccountsApi } from "@/test-utils/accounts-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeLabelsApi } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeRecurrencesApi, makeRecurrence } from "@/test-utils/recurrences-api";
import RecurrencesPage from "./bills";

function renderPage() {
  server.use(
    ...fakeRecurrencesApi([makeRecurrence({ name: "Netflix" })]).handlers,
    ...fakeAccountsApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
    ...fakeBudgetsApi([]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <RecurrencesPage />
      </MemoryRouter>
    </FakeAuth>,
  );
}

it("a pagina lista as recorrencias, que criam o lancamento sozinhas", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1, name: "Recorrentes" })).toBeInTheDocument();
  expect(await screen.findByText("Netflix")).toBeInTheDocument();
});
