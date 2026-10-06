import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { i18n } from "@/i18n";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import CategoriesPage from "./categories";
import TagsPage from "./tags";

// Categorias e tags em ingles: cada tipo tem as suas frases completas (nada de montar frase juntando o nome do tipo)
function renderPage(kind: "categories" | "tags", initial = [makeLabel({ name: "Groceries" })]) {
  const api = fakeLabelsApi(kind, initial);
  server.use(...api.handlers);
  render(
    <FakeAuth>
      <MemoryRouter>{kind === "categories" ? <CategoriesPage /> : <TagsPage />}</MemoryRouter>
    </FakeAuth>,
  );
}

it("a pagina de categorias em ingles: titulo, contagem, busca e dialogo", async () => {
  await i18n.changeLanguage("en");
  renderPage("categories", [makeLabel({ name: "Rent" }), makeLabel({ name: "Leisure" })]);
  expect(await screen.findByRole("heading", { level: 1, name: "Categories" })).toBeInTheDocument();
  expect(await screen.findByText("2 categories")).toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: "Search categories" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "New category" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Give the category a name and a color.")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Color")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Create" })).toBeInTheDocument();
});

it("uma categoria so no singular, e a tag tem as proprias frases", async () => {
  await i18n.changeLanguage("en");
  renderPage("categories", [makeLabel({ name: "Rent" })]);
  expect(await screen.findByText("1 category")).toBeInTheDocument();
});

it("a pagina de tags em ingles", async () => {
  await i18n.changeLanguage("en");
  renderPage("tags", [makeLabel({ name: "trip", color: null })]);
  expect(await screen.findByRole("heading", { level: 1, name: "Tags" })).toBeInTheDocument();
  expect(await screen.findByText("1 tag")).toBeInTheDocument();
  expect(screen.getByText(/Mark transactions with free-form words/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "New tag" }));
  expect(within(screen.getByRole("dialog")).getByText("Give the tag a name.")).toBeInTheDocument();
});

it("vazio e erro de nome em ingles", async () => {
  await i18n.changeLanguage("en");
  renderPage("categories", []);
  expect(await screen.findByText("No categories yet")).toBeInTheDocument();
  expect(screen.getByText("Create your first category to start organizing.")).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "New category" })[0]);
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create" }));
  expect(await screen.findByText("Enter the name.")).toBeInTheDocument();
});
