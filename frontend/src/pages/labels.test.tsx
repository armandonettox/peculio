import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { i18n } from "@/i18n";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import LabelsTabsPage from "./labels";

// A pagina e em abas (Categorias, Tags); por padrao abre em Categorias, a url ?aba=tags abre em Tags
function renderCategories(initial = [makeLabel({ name: "Mercado", color: "#00A878" })]) {
  const api = fakeLabelsApi("categories", initial);
  server.use(...api.handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <LabelsTabsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

function renderTags(initial = [makeLabel({ name: "viagem" })]) {
  const api = fakeLabelsApi("tags", initial);
  server.use(...api.handlers);
  render(
    <FakeAuth>
      <MemoryRouter initialEntries={["/categorias?aba=tags"]}>
        <LabelsTabsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const dialog = () => screen.getByRole("dialog");
const nameField = () => within(dialog()).getByLabelText("Nome");
const colorText = () => within(dialog()).getByLabelText("Cor");
const row = (name: string) => screen.getByText(name, { selector: "span" }).closest("li") as HTMLElement;
const openMenu = (name: string) => userEvent.click(screen.getByRole("button", { name: `Ações de ${name}` }));

// ---------- As abas ----------

it("a pagina tem as duas abas, Categorias ja aberta", async () => {
  renderCategories();
  expect(await screen.findByRole("heading", { level: 1, name: "Categorias e tags" })).toBeInTheDocument();
  for (const title of ["Categorias", "Tags"]) expect(screen.getByRole("tab", { name: title })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Categorias" })).toBeInTheDocument();
});

it("clicar na aba Tags troca o conteudo, mantendo o h1 da pagina", async () => {
  renderCategories();
  await screen.findByText("Mercado");
  await userEvent.click(screen.getByRole("tab", { name: "Tags" }));
  expect(await screen.findByRole("heading", { name: "Tags" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Categorias e tags" })).toBeInTheDocument();
  expect(screen.queryByText("Mercado")).not.toBeInTheDocument();
});

// ---------- Categorias: Lista ----------

it("lista as categorias em ordem alfabetica com a cor de cada uma", async () => {
  renderCategories([
    makeLabel({ name: "Lazer", color: "#E11D48" }),
    makeLabel({ name: "Casa", color: "#1E3A6B" }),
    makeLabel({ name: "Sem cor", color: null }),
  ]);
  await screen.findByText("Casa");
  const names = screen.getAllByRole("listitem").map((li) => li.textContent);
  expect(names).toEqual(["CasaSaída", "LazerSaída", "Sem corSaída"]);
  expect(screen.getByText("Casa")).toHaveAttribute("data-color", "#1E3A6B");
  expect(screen.getByText("Sem cor")).not.toHaveAttribute("data-color");
  expect(screen.getByText("3 categorias")).toBeInTheDocument();
});

it("uma so categoria usa o singular", async () => {
  renderCategories();
  expect(await screen.findByText("1 categoria")).toBeInTheDocument();
});

it("sem categorias mostra o estado vazio e o botao abre o formulario", async () => {
  renderCategories([]);
  expect(await screen.findByText("Nenhuma categoria ainda")).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "Nova categoria" })[1]);
  expect(dialog()).toHaveAccessibleName("Nova categoria");
});

it("mostra o carregamento enquanto busca", () => {
  const api = fakeLabelsApi("categories");
  server.use(...api.handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <LabelsTabsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Carregando categorias...");
});

it("erro ao listar mostra o aviso e tenta de novo", async () => {
  const api = renderCategories();
  await screen.findByText("Mercado");
  api.state.listError = true;
  await userEvent.type(screen.getByLabelText("Buscar categoria"), "x");
  expect(await screen.findByText("Algo deu errado do nosso lado. Tente novamente.")).toBeInTheDocument();

  api.state.listError = false;
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

// ---------- Categorias: Busca ----------

it("busca pelo nome depois de uma pausa na digitacao, sem uma chamada por tecla", async () => {
  const api = renderCategories([makeLabel({ name: "Mercado" }), makeLabel({ name: "Padaria" }), makeLabel({ name: "Feira" })]);
  await screen.findByText("Mercado");
  const before = api.state.requests.length;

  await userEvent.type(screen.getByLabelText("Buscar categoria"), "merc");

  await waitFor(() => expect(api.lastSearch()).toBe("merc"));
  expect(screen.queryByText("Padaria")).not.toBeInTheDocument();
  expect(screen.getByText("1 categoria com “merc”")).toBeInTheDocument();
  // 4 teclas nao viram 4 chamadas
  expect(api.state.requests.length - before).toBeLessThan(4);
});

it("busca sem resultado mostra Nada encontrado", async () => {
  renderCategories();
  await screen.findByText("Mercado");
  await userEvent.type(screen.getByLabelText("Buscar categoria"), "zzz");
  expect(await screen.findByText("Nada encontrado")).toBeInTheDocument();
  expect(screen.getByText("Nenhuma categoria tem “zzz” no nome.")).toBeInTheDocument();
});

it("apagar a busca traz a lista de volta", async () => {
  renderCategories();
  await screen.findByText("Mercado");
  const search = screen.getByLabelText("Buscar categoria");
  await userEvent.type(search, "zzz");
  await screen.findByText("Nada encontrado");
  await userEvent.clear(search);
  expect(await screen.findByText("Mercado")).toBeInTheDocument();
});

// ---------- Categorias: Criar ----------

async function openCreate() {
  await screen.findByText("Mercado");
  await userEvent.click(screen.getAllByRole("button", { name: "Nova categoria" })[0]);
}

it("cria uma categoria com a cor digitada", async () => {
  const api = renderCategories();
  await openCreate();
  await userEvent.type(nameField(), "Lazer");
  await userEvent.type(colorText(), "#e11d48");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));

  expect(await screen.findByText("Lazer")).toHaveAttribute("data-color", "#E11D48");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()[0].body).toEqual({ name: "Lazer", kind: "expense", color: "#E11D48" });
});

it("cria com uma cor das amostras", async () => {
  const api = renderCategories();
  await openCreate();
  await userEvent.type(nameField(), "Casa");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Usar a cor #8B5CF6" }));
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  await screen.findByText("Casa");
  expect(api.mutations()[0].body).toEqual({ name: "Casa", kind: "expense", color: "#8B5CF6" });
});

it("cria com uma cor qualquer escolhida no seletor do navegador", async () => {
  const api = renderCategories();
  await openCreate();
  await userEvent.type(nameField(), "Viagem");
  fireEvent.change(within(dialog()).getByLabelText("Escolher a cor no seletor"), { target: { value: "#123abc" } });
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  await screen.findByText("Viagem");
  expect(api.mutations()[0].body).toEqual({ name: "Viagem", kind: "expense", color: "#123ABC" });
});

it("sem cor envia so o nome", async () => {
  const api = renderCategories();
  await openCreate();
  await userEvent.type(nameField(), "Outros");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  await screen.findByText("Outros");
  expect(api.mutations()[0].body).toEqual({ name: "Outros", kind: "expense" });
});

it("a previa mostra como a categoria vai aparecer com o nome e a cor escolhidos", async () => {
  renderCategories();
  await openCreate();
  expect(within(dialog()).getByText("Nome da categoria")).toBeInTheDocument();
  await userEvent.type(nameField(), "Saude");
  await userEvent.type(colorText(), "#ff0000");
  const preview = within(dialog()).getByText("Saude", { selector: "span" });
  expect(preview).toHaveAttribute("data-color", "#FF0000");
});

it("o nome e limitado ao tamanho do backend", async () => {
  renderCategories();
  await openCreate();
  expect(nameField()).toHaveAttribute("maxlength", "100");
});

// ---------- Categorias: Validacao ----------

it("nome vazio mostra o erro, foca o campo e nao chama a API", async () => {
  const api = renderCategories();
  await openCreate();
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  expect(within(dialog()).getByText("Informe o nome.")).toBeInTheDocument();
  expect(nameField()).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it("cor invalida mostra o formato esperado e nao chama a API", async () => {
  const api = renderCategories();
  await openCreate();
  await userEvent.type(nameField(), "X");
  await userEvent.type(colorText(), "azul");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  expect(within(dialog()).getByText("Use o formato #RRGGBB, por exemplo #1E3A6B.")).toBeInTheDocument();
  expect(colorText()).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it("o erro some quando o usuario volta a digitar no campo", async () => {
  renderCategories();
  await openCreate();
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  await userEvent.type(nameField(), "A");
  expect(within(dialog()).queryByText("Informe o nome.")).not.toBeInTheDocument();
});

it("nome repetido (ignorando maiusculas) aparece no campo do nome", async () => {
  const api = renderCategories();
  await openCreate();
  await userEvent.type(nameField(), "mercado");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));

  expect(await within(dialog()).findByText("Já existe uma categoria com esse nome.")).toBeInTheDocument();
  expect(nameField()).toHaveFocus();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(api.state.items).toHaveLength(1);
});

it("erro de validacao do servidor mostra o campo e o aviso geral", async () => {
  const api = renderCategories();
  await openCreate();
  api.state.nextMutationError = {
    status: 422,
    code: "validation_error",
    errors: [{ field: "color", message: "Cor invalida" }],
  };
  await userEvent.type(nameField(), "X");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  expect(await within(dialog()).findByText("Cor invalida")).toBeInTheDocument();
  expect(within(dialog()).getByRole("alert")).toHaveTextContent("Confira os dados informados.");
});

it("falha do servidor mostra o aviso e libera o botao", async () => {
  const api = renderCategories();
  await openCreate();
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await userEvent.type(nameField(), "X");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");
  expect(within(dialog()).getByRole("button", { name: "Criar" })).toBeEnabled();
});

it("cancelar fecha sem criar nada", async () => {
  const api = renderCategories();
  await openCreate();
  await userEvent.type(nameField(), "X");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

// ---------- Categorias: Editar ----------

async function openEdit(name: string) {
  await screen.findByText(name);
  await openMenu(name);
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
}

it("editar abre com o nome e a cor atuais", async () => {
  renderCategories();
  await openEdit("Mercado");
  expect(dialog()).toHaveAccessibleName("Editar categoria");
  expect(nameField()).toHaveValue("Mercado");
  expect(colorText()).toHaveValue("#00A878");
});

it("mudar so o nome envia so o nome (a cor fica como esta)", async () => {
  const api = renderCategories();
  await openEdit("Mercado");
  await userEvent.clear(nameField());
  await userEvent.type(nameField(), "Supermercado");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));

  expect(await screen.findByText("Supermercado")).toHaveAttribute("data-color", "#00A878");
  expect(api.mutations()[0].body).toEqual({ name: "Supermercado" });
});

it("mudar so a cor envia so a cor", async () => {
  const api = renderCategories();
  await openEdit("Mercado");
  await userEvent.clear(colorText());
  await userEvent.type(colorText(), "#0000ff");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(screen.getByText("Mercado")).toHaveAttribute("data-color", "#0000FF"));
  expect(api.mutations()[0].body).toEqual({ color: "#0000FF" });
});

it("Sem cor limpa a cor com null", async () => {
  const api = renderCategories();
  await openEdit("Mercado");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Sem cor" }));
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(screen.getByText("Mercado")).not.toHaveAttribute("data-color"));
  expect(api.mutations()[0].body).toEqual({ color: null });
});

it("salvar sem mudar nada fecha sem chamar a API", async () => {
  const api = renderCategories();
  await openEdit("Mercado");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("trocar so a caixa do proprio nome e permitido", async () => {
  const api = renderCategories();
  await openEdit("Mercado");
  await userEvent.clear(nameField());
  await userEvent.type(nameField(), "MERCADO");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  expect(await screen.findByText("MERCADO")).toBeInTheDocument();
  expect(api.mutations()[0].body).toEqual({ name: "MERCADO" });
});

it("renomear para o nome de outra categoria mostra o erro no campo", async () => {
  renderCategories([makeLabel({ name: "Mercado" }), makeLabel({ name: "Feira" })]);
  await openEdit("Mercado");
  await userEvent.clear(nameField());
  await userEvent.type(nameField(), "feira");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  expect(await within(dialog()).findByText("Já existe uma categoria com esse nome.")).toBeInTheDocument();
});

// ---------- Categorias: Excluir ----------

it("excluir pede confirmacao, explica a consequencia e remove", async () => {
  const api = renderCategories([makeLabel({ name: "Descartavel" }), makeLabel({ name: "Fica" })]);
  await screen.findByText("Descartavel");
  await openMenu("Descartavel");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));

  expect(dialog()).toHaveAccessibleName("Excluir categoria");
  expect(within(dialog()).getByText("Descartavel")).toBeInTheDocument();
  expect(within(dialog()).getByText(/As transações dela ficarão sem categoria/)).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);

  await userEvent.click(within(dialog()).getByRole("button", { name: "Excluir" }));
  await waitFor(() => expect(screen.queryByText("Descartavel")).not.toBeInTheDocument());
  expect(screen.getByText("Fica")).toBeInTheDocument();
  expect(api.mutations()[0].method).toBe("DELETE");
});

it("cancelar a exclusao nao apaga nada", async () => {
  const api = renderCategories();
  await screen.findByText("Mercado");
  await openMenu("Mercado");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  await userEvent.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
  expect(api.mutations()).toHaveLength(0);
  expect(screen.getByText("Mercado")).toBeInTheDocument();
});

it("falha ao excluir mostra o erro e mantem o dialogo aberto", async () => {
  const api = renderCategories();
  await screen.findByText("Mercado");
  api.state.nextMutationError = { status: 404, code: "category_not_found" };
  await openMenu("Mercado");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  await userEvent.click(within(dialog()).getByRole("button", { name: "Excluir" }));
  expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Categoria não encontrada.");
  expect(within(dialog()).getByRole("button", { name: "Excluir" })).toBeEnabled();
});

it("a linha usa o item certo mesmo com nomes parecidos", async () => {
  renderCategories([makeLabel({ name: "Casa" }), makeLabel({ name: "Casa nova" })]);
  await screen.findByText("Casa nova");
  expect(row("Casa nova")).toBeInTheDocument();
});

// ---------- Tags ----------

it("lista as tags em ordem alfabetica, sem cor", async () => {
  renderTags([makeLabel({ name: "reembolso" }), makeLabel({ name: "Viagem" }), makeLabel({ name: "casa" })]);
  await screen.findByText("casa");
  expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["casa", "reembolso", "Viagem"]);
  expect(screen.getByText("3 tags")).toBeInTheDocument();
  expect(screen.getByText("casa")).not.toHaveAttribute("data-color");
});

it("sem tags mostra o estado vazio", async () => {
  renderTags([]);
  expect(await screen.findByText("Nenhuma tag ainda")).toBeInTheDocument();
});

it("o formulario de tag nao tem escolha de cor", async () => {
  renderTags();
  await screen.findByText("viagem");
  await userEvent.click(screen.getAllByRole("button", { name: "Nova tag" })[0]);
  expect(dialog()).toHaveAccessibleName("Nova tag");
  expect(within(dialog()).queryByLabelText("Cor")).not.toBeInTheDocument();
  expect(within(dialog()).queryByRole("group", { name: "Cores sugeridas" })).not.toBeInTheDocument();
  expect(nameField()).toHaveAttribute("maxlength", "50");
});

it("cria uma tag enviando so o nome", async () => {
  const api = renderTags();
  await screen.findByText("viagem");
  await userEvent.click(screen.getAllByRole("button", { name: "Nova tag" })[0]);
  await userEvent.type(nameField(), "  reembolso  ");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));

  expect(await screen.findByText("reembolso")).toBeInTheDocument();
  expect(api.mutations()[0].body).toEqual({ name: "reembolso" });
});

it("nome vazio nao chama a API (tags)", async () => {
  const api = renderTags();
  await screen.findByText("viagem");
  await userEvent.click(screen.getAllByRole("button", { name: "Nova tag" })[0]);
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  expect(within(dialog()).getByText("Informe o nome.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("nome repetido aparece no campo, ignorando maiusculas (tags)", async () => {
  renderTags();
  await screen.findByText("viagem");
  await userEvent.click(screen.getAllByRole("button", { name: "Nova tag" })[0]);
  await userEvent.type(nameField(), "VIAGEM");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar" }));
  expect(await within(dialog()).findByText("Já existe uma tag com esse nome.")).toBeInTheDocument();
});

it("renomear envia so o nome e mantem a lista ordenada", async () => {
  const api = renderTags([makeLabel({ name: "b" }), makeLabel({ name: "c" })]);
  await screen.findByText("b");
  await openMenu("b");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.clear(nameField());
  await userEvent.type(nameField(), "d");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["c", "d"]));
  expect(api.mutations()[0].body).toEqual({ name: "d" });
});

it("salvar sem mudar nada nao chama a API (tags)", async () => {
  const api = renderTags();
  await screen.findByText("viagem");
  await openMenu("viagem");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  expect(api.mutations()).toHaveLength(0);
});

it("busca filtra as tags", async () => {
  const api = renderTags([makeLabel({ name: "viagem" }), makeLabel({ name: "reembolso" })]);
  await screen.findByText("viagem");
  await userEvent.type(screen.getByLabelText("Buscar tag"), "reem");
  await waitFor(() => expect(api.lastSearch()).toBe("reem"));
  expect(screen.queryByText("viagem")).not.toBeInTheDocument();
  expect(screen.getByText("reembolso")).toBeInTheDocument();
});

it("excluir explica que a tag sai das transacoes e remove", async () => {
  const api = renderTags();
  await screen.findByText("viagem");
  await openMenu("viagem");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  expect(within(dialog()).getByText(/Ela será removida das transações que a usam/)).toBeInTheDocument();
  await userEvent.click(within(dialog()).getByRole("button", { name: "Excluir" }));
  expect(await screen.findByText("Nenhuma tag ainda")).toBeInTheDocument();
  expect(api.mutations()[0].method).toBe("DELETE");
});

// ---------- Em ingles ----------

it("a pagina em ingles: titulo da aba, contagem, busca e dialogo", async () => {
  await i18n.changeLanguage("en");
  renderCategories([makeLabel({ name: "Rent" }), makeLabel({ name: "Leisure" })]);
  expect(await screen.findByRole("heading", { level: 1, name: "Categories and tags" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();
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
  renderCategories([makeLabel({ name: "Rent" })]);
  expect(await screen.findByText("1 category")).toBeInTheDocument();
});

it("a aba Tags em ingles", async () => {
  await i18n.changeLanguage("en");
  renderTags([makeLabel({ name: "trip", color: null })]);
  expect(await screen.findByRole("heading", { name: "Tags" })).toBeInTheDocument();
  expect(await screen.findByText("1 tag")).toBeInTheDocument();
  expect(screen.getByText(/Mark transactions with free-form words/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "New tag" }));
  expect(within(screen.getByRole("dialog")).getByText("Give the tag a name.")).toBeInTheDocument();
});

it("vazio e erro de nome em ingles", async () => {
  await i18n.changeLanguage("en");
  renderCategories([]);
  expect(await screen.findByText("No categories yet")).toBeInTheDocument();
  expect(screen.getByText("Create your first category to start organizing.")).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "New category" })[0]);
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create" }));
  expect(await screen.findByText("Enter the name.")).toBeInTheDocument();
});
