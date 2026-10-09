import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import AccountsPage from "./accounts";

function renderPage(accounts = [makeAccount({ name: "Nubank", balance: "1234.50" })]) {
  const api = fakeAccountsApi(accounts);
  server.use(...api.handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <AccountsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("li") as HTMLElement;
const openMenu = async (name: string) => {
  await userEvent.click(screen.getByRole("button", { name: `Ações da conta ${name}` }));
};

// ---------- Lista ----------

it("lista as contas com o saldo formatado em reais", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 3, name: "Nubank" })).toBeInTheDocument();
  expect(within(card("Nubank")).getByText("R$ 1.234,50")).toBeInTheDocument();
  expect(within(card("Nubank")).getByText("Conta corrente")).toBeInTheDocument();
});

it("separa Contas e Dividas, com o total de cada grupo", async () => {
  renderPage([
    makeAccount({ name: "Nubank", balance: "1000.00" }),
    makeAccount({ name: "Poupanca", role: "savings", balance: "250.50" }),
    makeAccount({ name: "Financiamento", type: "liability", role: "mortgage", balance: "-400.00" }),
  ]);
  await screen.findByRole("heading", { level: 3, name: "Nubank" });

  const assets = screen.getByRole("region", { name: "Contas" });
  expect(within(assets).getByText("R$ 1.250,50")).toBeInTheDocument();
  expect(within(assets).queryByText("Financiamento")).not.toBeInTheDocument();

  const debts = screen.getByRole("region", { name: "Dívidas" });
  expect(within(debts).getByRole("heading", { level: 3, name: "Financiamento" })).toBeInTheDocument();
  expect(within(debts).getByText("Total devido:")).toBeInTheDocument();
  expect(within(debts).getAllByText("R$ 400,00").length).toBeGreaterThan(0);
});

it("divida mostra o valor devido positivo, nao o saldo negativo", async () => {
  renderPage([makeAccount({ name: "Emprestimo", type: "liability", role: "loan", balance: "-5000.00" })]);
  await screen.findByRole("heading", { level: 3, name: "Emprestimo" });
  const item = card("Emprestimo");
  expect(within(item).getByText("R$ 5.000,00")).toBeInTheDocument();
  expect(within(item).getByText("Valor devido")).toBeInTheDocument();
  expect(within(item).queryByText(/-R\$/)).not.toBeInTheDocument();
});

it("mostra o patrimonio liquido so quando ha dividas", async () => {
  renderPage([
    makeAccount({ name: "Nubank", balance: "1000.00" }),
    makeAccount({ name: "Divida", type: "liability", role: "debt", balance: "-300.00" }),
  ]);
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  expect(screen.getByText("Patrimônio líquido:")).toBeInTheDocument();
  expect(screen.getByText("R$ 700,00")).toBeInTheDocument();
});

it("sem dividas nao mostra patrimonio liquido", async () => {
  renderPage();
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  expect(screen.queryByText("Patrimônio líquido:")).not.toBeInTheDocument();
});

it("saldo negativo de uma conta aparece em destaque de erro", async () => {
  renderPage([makeAccount({ name: "Cheque especial", balance: "-50.00" })]);
  await screen.findByRole("heading", { level: 3, name: "Cheque especial" });
  expect(within(card("Cheque especial")).getByText(/R\$\s?50,00/)).toHaveClass("text-destructive");
});

it("totais de moedas diferentes ficam separados", async () => {
  renderPage([
    makeAccount({ name: "Nubank", balance: "100.00" }),
    makeAccount({ name: "Wise", currency_code: "USD", balance: "50.00" }),
  ]);
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  const total = screen.getByText("Total:").closest("p") as HTMLElement;
  expect(total).toHaveTextContent("R$ 100,00 · US$ 50,00");
});

it("conta em outra moeda mostra o codigo da moeda", async () => {
  renderPage([makeAccount({ name: "Wise", currency_code: "USD", balance: "50.00" })]);
  await screen.findByRole("heading", { level: 3, name: "Wise" });
  expect(within(card("Wise")).getByText(/USD/)).toBeInTheDocument();
});

it("sem contas mostra o estado vazio e o botao abre o formulario", async () => {
  renderPage([]);
  expect(await screen.findByText("Nenhuma conta ativa")).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "Nova conta" })[1]);
  expect(screen.getByRole("dialog", { name: "Nova conta" })).toBeInTheDocument();
});

it("mostra o carregamento enquanto busca", () => {
  const api = fakeAccountsApi();
  server.use(...api.handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <AccountsPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Carregando contas...");
});

it("erro ao listar mostra o aviso e tenta de novo", async () => {
  const api = renderPage();
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  // Liga o erro so depois da primeira busca; o interruptor forca uma nova
  api.state.listError = true;
  await userEvent.click(screen.getByLabelText("Mostrar arquivadas"));
  expect(await screen.findByText("Algo deu errado do nosso lado. Tente novamente.")).toBeInTheDocument();

  api.state.listError = false;
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("heading", { level: 3, name: "Nubank" })).toBeInTheDocument();
});

// ---------- Criar ----------

const dialog = () => screen.getByRole("dialog");
const nameField = () => within(dialog()).getByLabelText("Nome");
const openingField = () => within(dialog()).getByLabelText(/Saldo inicial|Quanto você deve/);

async function openCreate() {
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  await userEvent.click(screen.getAllByRole("button", { name: "Nova conta" })[0]);
}

it("cria uma conta com saldo inicial no formato brasileiro", async () => {
  const api = renderPage();
  await openCreate();

  await userEvent.type(nameField(), "Itau");
  await userEvent.type(openingField(), "3.200,50");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));

  expect(await screen.findByRole("heading", { level: 3, name: "Itau" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(within(card("Itau")).getByText("R$ 3.200,50")).toBeInTheDocument();
  expect(api.mutations()[0].body).toEqual({
    name: "Itau",
    type: "asset",
    role: "checking",
    currency_code: "BRL",
    in_envelopes: true,
    notes: null,
    opening_balance: "3200.50",
    opening_balance_date: new Date().toLocaleDateString("sv-SE"),
  });
});

it("sem saldo inicial envia zero e nenhuma data", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.type(nameField(), "Carteira");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));

  await screen.findByRole("heading", { level: 3, name: "Carteira" });
  expect(api.mutations()[0].body).toMatchObject({ opening_balance: "0" });
  expect(api.mutations()[0].body).not.toHaveProperty("opening_balance_date");
});

it("a data do saldo so aparece quando ha saldo", async () => {
  renderPage();
  await openCreate();
  expect(within(dialog()).queryByLabelText("Data do saldo")).not.toBeInTheDocument();
  await userEvent.type(openingField(), "10");
  expect(within(dialog()).getByLabelText("Data do saldo")).toBeInTheDocument();
});

it("cria uma divida: o campo vira Quanto voce deve e os papeis mudam", async () => {
  const api = renderPage();
  await openCreate();

  await userEvent.click(within(dialog()).getByRole("radio", { name: "Dívida" }));
  expect(within(dialog()).getByLabelText("Quanto você deve")).toBeInTheDocument();
  const roles = within(within(dialog()).getByLabelText("Categoria da conta"))
    .getAllByRole("option")
    .map((option) => option.textContent);
  expect(roles).toEqual(["Empréstimo", "Dívida", "Financiamento"]);

  await userEvent.type(nameField(), "Carro");
  await userEvent.type(openingField(), "12.000");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));

  await screen.findByRole("heading", { level: 3, name: "Carro" });
  expect(api.mutations()[0].body).toMatchObject({ type: "liability", role: "debt", opening_balance: "12000.00" });
  expect(within(card("Carro")).getByText("R$ 12.000,00")).toBeInTheDocument();
});

it("o papel escolhido e enviado", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.selectOptions(within(dialog()).getByLabelText("Categoria da conta"), "savings");
  await userEvent.type(nameField(), "Reserva");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));
  await screen.findByRole("heading", { level: 3, name: "Reserva" });
  expect(api.mutations()[0].body).toMatchObject({ role: "savings" });
});

it("a moeda escolhida e enviada e o iene nao aceita centavos", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.selectOptions(within(dialog()).getByLabelText("Moeda"), "JPY");
  await userEvent.type(nameField(), "Toquio");
  await userEvent.type(openingField(), "100,5");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));

  expect(within(dialog()).getByText("Esta moeda não tem centavos.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);

  await userEvent.clear(openingField());
  await userEvent.type(openingField(), "100");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));
  await screen.findByRole("heading", { level: 3, name: "Toquio" });
  expect(api.mutations()[0].body).toMatchObject({ currency_code: "JPY", opening_balance: "100" });
});

it("usa a moeda padrao do usuario", async () => {
  renderPage();
  await openCreate();
  expect(within(dialog()).getByLabelText("Moeda")).toHaveValue("BRL");
});

it("notas em branco viram nulo e notas preenchidas sao enviadas", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.type(nameField(), "Com nota");
  await userEvent.type(within(dialog()).getByLabelText("Notas"), "  principal  ");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));
  await screen.findByRole("heading", { level: 3, name: "Com nota" });
  expect(api.mutations()[0].body).toMatchObject({ notes: "principal" });
});

// ---------- Validacao no formulario ----------

it("nome vazio mostra o erro, foca o campo e nao chama a API", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));

  expect(within(dialog()).getByText("Informe o nome da conta.")).toBeInTheDocument();
  expect(nameField()).toHaveFocus();
  expect(nameField()).toHaveAttribute("aria-invalid", "true");
  expect(api.mutations()).toHaveLength(0);
});

it.each([
  ["abc", "Valor inválido."],
  ["10,555", "Use no máximo 2 casas decimais."],
  ["1,2,3", "Valor inválido."],
])("saldo %j mostra %j", async (typed, message) => {
  const api = renderPage();
  await openCreate();
  await userEvent.type(nameField(), "X");
  await userEvent.type(openingField(), typed);
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));

  expect(within(dialog()).getByText(message)).toBeInTheDocument();
  expect(openingField()).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it("divida com valor negativo e recusada", async () => {
  renderPage();
  await openCreate();
  await userEvent.click(within(dialog()).getByRole("radio", { name: "Dívida" }));
  await userEvent.type(nameField(), "Carro");
  await userEvent.type(openingField(), "-100");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));
  expect(within(dialog()).getByText("Informe quanto você deve como um valor positivo.")).toBeInTheDocument();
});

it("conta de ativo aceita saldo inicial negativo", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.type(nameField(), "Cheque especial");
  await userEvent.type(openingField(), "-50,00");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));
  await screen.findByRole("heading", { level: 3, name: "Cheque especial" });
  expect(api.mutations()[0].body).toMatchObject({ opening_balance: "-50.00" });
});

it("data do saldo apagada e recusada", async () => {
  renderPage();
  await openCreate();
  await userEvent.type(nameField(), "X");
  await userEvent.type(openingField(), "10");
  await userEvent.clear(within(dialog()).getByLabelText("Data do saldo"));
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));
  expect(within(dialog()).getByText("Informe uma data válida.")).toBeInTheDocument();
});

it("o erro de um campo some quando o usuario volta a digitar nele", async () => {
  renderPage();
  await openCreate();
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));
  expect(within(dialog()).getByText("Informe o nome da conta.")).toBeInTheDocument();
  await userEvent.type(nameField(), "A");
  expect(within(dialog()).queryByText("Informe o nome da conta.")).not.toBeInTheDocument();
});

// ---------- Erros do servidor ----------

it("nome repetido aparece no campo do nome", async () => {
  const api = renderPage();
  await openCreate();
  api.state.nextMutationError = { status: 409, code: "account_name_taken" };
  await userEvent.type(nameField(), "Nubank");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));

  expect(await within(dialog()).findByText("Já existe uma conta com esse nome.")).toBeInTheDocument();
  expect(nameField()).toHaveFocus();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("valor invalido para a moeda aparece no campo do saldo", async () => {
  const api = renderPage();
  await openCreate();
  api.state.nextMutationError = { status: 400, code: "invalid_amount" };
  await userEvent.type(nameField(), "X");
  await userEvent.type(openingField(), "10");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));
  expect(await within(dialog()).findByText("Valor inválido para esta moeda.")).toBeInTheDocument();
});

it("erro de validacao do servidor mostra os campos e o aviso geral", async () => {
  const api = renderPage();
  await openCreate();
  api.state.nextMutationError = {
    status: 422,
    code: "validation_error",
    errors: [{ field: "name", message: "Nome muito longo" }],
  };
  await userEvent.type(nameField(), "X");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));
  expect(await within(dialog()).findByText("Nome muito longo")).toBeInTheDocument();
  expect(within(dialog()).getByRole("alert")).toHaveTextContent("Confira os dados informados.");
});

it("erro sem campo (moeda desconhecida) vai no aviso do topo e o botao volta a funcionar", async () => {
  const api = renderPage();
  await openCreate();
  api.state.nextMutationError = { status: 400, code: "currency_not_found" };
  await userEvent.type(nameField(), "X");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));

  expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Moeda não encontrada.");
  expect(within(dialog()).getByRole("button", { name: "Criar conta" })).toBeEnabled();
});

it("cancelar fecha sem criar nada", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.type(nameField(), "X");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

// ---------- Editar ----------

it("editar abre com os dados atuais e nao deixa mudar tipo nem moeda", async () => {
  renderPage([
    makeAccount({
      name: "Nubank",
      notes: "principal",
      opening_balance: "1234.50",
      opening_balance_date: "2026-01-10",
      balance: "1234.50",
    }),
  ]);
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  await openMenu("Nubank");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));

  expect(dialog()).toHaveAccessibleName("Editar conta");
  expect(nameField()).toHaveValue("Nubank");
  expect(within(dialog()).getByLabelText("Notas")).toHaveValue("principal");
  expect(openingField()).toHaveValue("1234,50");
  expect(within(dialog()).getByLabelText("Data do saldo")).toHaveValue("2026-01-10");
  expect(within(dialog()).getByLabelText("Moeda")).toBeDisabled();
  expect(within(dialog()).queryByRole("radio")).not.toBeInTheDocument();
});

it("editar so o nome envia so o nome", async () => {
  const api = renderPage();
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  await openMenu("Nubank");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.clear(nameField());
  await userEvent.type(nameField(), "Nubank Roxinho");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));

  expect(await screen.findByRole("heading", { level: 3, name: "Nubank Roxinho" })).toBeInTheDocument();
  expect(api.mutations()[0].body).toEqual({ name: "Nubank Roxinho" });
});

it("salvar sem mudar nada fecha sem chamar a API", async () => {
  const api = renderPage();
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  await openMenu("Nubank");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("mudar o saldo inicial envia o valor e a data", async () => {
  const api = renderPage([
    makeAccount({ name: "Nubank", opening_balance: "100.00", opening_balance_date: "2026-01-10", balance: "100.00" }),
  ]);
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  await openMenu("Nubank");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.clear(openingField());
  await userEvent.type(openingField(), "250,75");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(within(card("Nubank")).getByText("R$ 250,75")).toBeInTheDocument());
  expect(api.mutations()[0].body).toEqual({ opening_balance: "250.75", opening_balance_date: "2026-01-10" });
});

it("apagar o saldo inicial envia zero para remove-lo", async () => {
  const api = renderPage([
    makeAccount({ name: "Nubank", opening_balance: "100.00", opening_balance_date: "2026-01-10", balance: "100.00" }),
  ]);
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  await openMenu("Nubank");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.clear(openingField());
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(within(card("Nubank")).getByText("R$ 0,00")).toBeInTheDocument());
  expect(api.mutations()[0].body).toEqual({ opening_balance: "0.00" });
});

it("conta sem saldo inicial abre com o campo vazio e nao manda nada se nao for preenchido", async () => {
  const api = renderPage();
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  await openMenu("Nubank");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  expect(openingField()).toHaveValue("");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  expect(api.mutations()).toHaveLength(0);
});

it("editar uma divida mostra so os papeis de divida", async () => {
  renderPage([makeAccount({ name: "Carro", type: "liability", role: "loan", balance: "-10.00" })]);
  await screen.findByRole("heading", { level: 3, name: "Carro" });
  await openMenu("Carro");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  const roles = within(within(dialog()).getByLabelText("Categoria da conta"))
    .getAllByRole("option")
    .map((option) => option.textContent);
  expect(roles).toEqual(["Empréstimo", "Dívida", "Financiamento"]);
  expect(within(dialog()).getByLabelText("Categoria da conta")).toHaveValue("loan");
});

// ---------- Arquivar ----------

it("arquivar tira a conta da lista", async () => {
  const api = renderPage([makeAccount({ name: "Antiga" }), makeAccount({ name: "Atual" })]);
  await screen.findByRole("heading", { level: 3, name: "Antiga" });
  await openMenu("Antiga");
  await userEvent.click(screen.getByRole("menuitem", { name: "Arquivar" }));

  await screen.findByRole("heading", { level: 3, name: "Atual" });
  expect(screen.queryByRole("heading", { level: 3, name: "Antiga" })).not.toBeInTheDocument();
  expect(api.mutations()[0].body).toEqual({ active: false });
});

it("mostrar arquivadas traz a conta de volta com a marca e a opcao Restaurar", async () => {
  renderPage([makeAccount({ name: "Antiga", active: false }), makeAccount({ name: "Atual" })]);
  await screen.findByRole("heading", { level: 3, name: "Atual" });
  expect(screen.queryByRole("heading", { level: 3, name: "Antiga" })).not.toBeInTheDocument();

  await userEvent.click(screen.getByLabelText("Mostrar arquivadas"));
  expect(await screen.findByRole("heading", { level: 3, name: "Antiga" })).toBeInTheDocument();
  expect(within(card("Antiga")).getByText("Arquivada")).toBeInTheDocument();

  await openMenu("Antiga");
  await userEvent.click(screen.getByRole("menuitem", { name: "Restaurar" }));
  await userEvent.click(screen.getByLabelText("Mostrar arquivadas"));
  await userEvent.click(screen.getByLabelText("Mostrar arquivadas"));
  expect(await screen.findByRole("heading", { level: 3, name: "Antiga" })).toBeInTheDocument();
  expect(within(card("Antiga")).queryByText("Arquivada")).not.toBeInTheDocument();
});

it("conta arquivada nao entra no total", async () => {
  renderPage([makeAccount({ name: "Ativa", balance: "10.00" }), makeAccount({ name: "Velha", active: false, balance: "999.00" })]);
  await screen.findByRole("heading", { level: 3, name: "Ativa" });
  await userEvent.click(screen.getByLabelText("Mostrar arquivadas"));
  await screen.findByRole("heading", { level: 3, name: "Velha" });
  expect(screen.getByText("Total:").closest("p")).toHaveTextContent("R$ 10,00");
});

it("falha ao arquivar mostra o aviso na pagina", async () => {
  const api = renderPage();
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  await openMenu("Nubank");
  await userEvent.click(screen.getByRole("menuitem", { name: "Arquivar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");
  expect(screen.getByRole("heading", { level: 3, name: "Nubank" })).toBeInTheDocument();
});

// ---------- Excluir ----------

it("excluir pede confirmacao e remove a conta", async () => {
  const api = renderPage([makeAccount({ name: "Descartavel" }), makeAccount({ name: "Fica" })]);
  await screen.findByRole("heading", { level: 3, name: "Descartavel" });
  await openMenu("Descartavel");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));

  expect(dialog()).toHaveAccessibleName("Excluir conta");
  expect(within(dialog()).getByText("Descartavel")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);

  await userEvent.click(within(dialog()).getByRole("button", { name: "Excluir" }));
  await screen.findByRole("heading", { level: 3, name: "Fica" });
  expect(screen.queryByRole("heading", { level: 3, name: "Descartavel" })).not.toBeInTheDocument();
  expect(api.mutations()[0].method).toBe("DELETE");
});

it("cancelar a exclusao nao apaga nada", async () => {
  const api = renderPage();
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  await openMenu("Nubank");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  await userEvent.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
  expect(screen.getByRole("heading", { level: 3, name: "Nubank" })).toBeInTheDocument();
});

it("conta com transacoes nao exclui: explica e oferece arquivar", async () => {
  const api = renderPage();
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  api.state.nextMutationError = { status: 409, code: "account_has_transactions" };
  await openMenu("Nubank");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  await userEvent.click(within(dialog()).getByRole("button", { name: "Excluir" }));

  expect(await within(dialog()).findByRole("alert")).toHaveTextContent("tem transações e não pode ser excluída");
  expect(within(dialog()).queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();

  await userEvent.click(within(dialog()).getByRole("button", { name: "Arquivar em vez disso" }));
  await screen.findByText("Nenhuma conta ativa");
  expect(api.mutations().map((m) => m.method)).toEqual(["DELETE", "PATCH"]);
  expect(api.mutations()[1].body).toEqual({ active: false });
});

// ---------- Entra nos envelopes ----------

it("conta de ativo nova vem com Entra nos envelopes marcado e envia o valor escolhido", async () => {
  const api = renderPage();
  await openCreate();
  const box = within(dialog()).getByLabelText(/Entra nos envelopes/);
  expect(box).toBeChecked();
  await userEvent.type(nameField(), "Reserva longa");
  await userEvent.click(box);
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toMatchObject({ name: "Reserva longa", in_envelopes: false });
});

it("divida nao mostra a opcao de entrar nos envelopes", async () => {
  renderPage();
  await openCreate();
  expect(within(dialog()).getByLabelText(/Entra nos envelopes/)).toBeInTheDocument();
  await userEvent.click(within(dialog()).getByRole("radio", { name: /Dívida/ }));
  expect(within(dialog()).queryByLabelText(/Entra nos envelopes/)).not.toBeInTheDocument();
});

it("editar mostra o valor atual e so manda in_envelopes quando muda", async () => {
  const api = renderPage([makeAccount({ name: "Poupanca", in_envelopes: false })]);
  await screen.findByRole("heading", { level: 3, name: "Poupanca" });
  await openMenu("Poupanca");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  const box = within(dialog()).getByLabelText(/Entra nos envelopes/);
  expect(box).not.toBeChecked();
  await userEvent.type(nameField(), "2");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ name: "Poupanca2" });

  await openMenu("Poupanca2");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.click(within(dialog()).getByLabelText(/Entra nos envelopes/));
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(2));
  expect(api.mutations()[1].body).toEqual({ in_envelopes: true });
});

// ---------- Cartao de credito ----------

it("os campos de fechamento e vencimento so aparecem com o papel cartao de credito", async () => {
  renderPage();
  await openCreate();
  expect(within(dialog()).queryByLabelText("Dia de fechamento")).not.toBeInTheDocument();
  await userEvent.selectOptions(within(dialog()).getByLabelText("Categoria da conta"), "credit_card");
  expect(within(dialog()).getByLabelText("Dia de fechamento")).toBeInTheDocument();
  expect(within(dialog()).getByLabelText("Dia de vencimento")).toBeInTheDocument();
});

it("cartao de credito sem fechamento ou vencimento mostra o erro e nao chama a API", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.selectOptions(within(dialog()).getByLabelText("Categoria da conta"), "credit_card");
  await userEvent.type(nameField(), "Nubank cartao");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));

  expect(within(dialog()).getAllByText("Informe um dia entre 1 e 31.")).toHaveLength(2);
  expect(within(dialog()).getByLabelText("Dia de fechamento")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it("cria um cartao de credito com fechamento e vencimento", async () => {
  const api = renderPage();
  await openCreate();
  await userEvent.selectOptions(within(dialog()).getByLabelText("Categoria da conta"), "credit_card");
  await userEvent.type(nameField(), "Nubank cartao");
  await userEvent.type(within(dialog()).getByLabelText("Dia de fechamento"), "5");
  await userEvent.type(within(dialog()).getByLabelText("Dia de vencimento"), "12");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Criar conta" }));

  await screen.findByRole("heading", { level: 3, name: "Nubank cartao" });
  expect(api.mutations()[0].body).toMatchObject({ role: "credit_card", closing_day: 5, due_day: 12 });
});

it("editar um cartao de credito mostra o fechamento e o vencimento atuais", async () => {
  renderPage([makeAccount({ name: "Cartao", role: "credit_card", closing_day: 10, due_day: 17 })]);
  await screen.findByRole("heading", { level: 3, name: "Cartao" });
  await openMenu("Cartao");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  expect(within(dialog()).getByLabelText("Dia de fechamento")).toHaveValue(10);
  expect(within(dialog()).getByLabelText("Dia de vencimento")).toHaveValue(17);
});

it("trocar o papel para fora de cartao de credito limpa o fechamento e o vencimento", async () => {
  const api = renderPage([makeAccount({ name: "Cartao", role: "credit_card", closing_day: 10, due_day: 17 })]);
  await screen.findByRole("heading", { level: 3, name: "Cartao" });
  await openMenu("Cartao");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.selectOptions(within(dialog()).getByLabelText("Categoria da conta"), "checking");
  await userEvent.click(within(dialog()).getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ role: "checking", closing_day: null, due_day: null });
});

it("o link Ver fatura so aparece para cartao de credito e leva para a tela da fatura", async () => {
  renderPage([makeAccount({ name: "Cartao", role: "credit_card", closing_day: 10, due_day: 17 })]);
  await screen.findByRole("heading", { level: 3, name: "Cartao" });
  await openMenu("Cartao");
  expect(screen.getByRole("menuitem", { name: "Ver fatura" })).toHaveAttribute(
    "href",
    expect.stringContaining("/fatura"),
  );
});

it("conta comum nao mostra o link Ver fatura", async () => {
  renderPage();
  await screen.findByRole("heading", { level: 3, name: "Nubank" });
  await openMenu("Nubank");
  expect(screen.queryByRole("menuitem", { name: "Ver fatura" })).not.toBeInTheDocument();
});
