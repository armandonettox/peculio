import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBillsApi, makeBill } from "@/test-utils/bills-api";
import { fakeBudgetsApi, makeBudget } from "@/test-utils/budgets-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeRulesApi, makeRule, makeRuleGroup } from "@/test-utils/rules-api";
import RulesPage from "./rules";

const account = makeAccount({ name: "Nubank" });
const category = makeLabel({ name: "Mercado" });
const otherCategory = makeLabel({ name: "Lazer" });
const tag = makeLabel({ name: "casa" });
const otherTag = makeLabel({ name: "viagem" });
const budget = makeBudget({ name: "Casa" });
const bill = makeBill({ name: "Netflix" });

function renderPage(initial: Parameters<typeof fakeRulesApi>[0] = {}) {
  const api = fakeRulesApi(initial);
  server.use(
    ...api.handlers,
    ...fakeAccountsApi([account]).handlers,
    ...fakeLabelsApi("categories", [category, otherCategory]).handlers,
    ...fakeLabelsApi("tags", [tag, otherTag]).handlers,
    ...fakeBudgetsApi([budget]).handlers,
    ...fakeBillsApi([bill]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <RulesPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const rule = (overrides = {}) =>
  makeRule({ name: "Mercado", actions: [{ kind: "set_category", target_id: category.id }], ...overrides });

const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("li") as HTMLElement;
const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());
const openMenu = async (label: string) => userEvent.click(screen.getByRole("button", { name: label }));
const select = (name: string) => inDialog().getByRole("combobox", { name });

// ---------- Lista ----------

it("sem regras mostra o estado vazio com o botao de criar", async () => {
  renderPage();
  expect(await screen.findByText("Nenhuma regra ainda")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Nova regra" }).length).toBeGreaterThan(0);
});

it("mostra o carregamento e depois a regra", async () => {
  renderPage({ rules: [rule()] });
  expect(screen.getByRole("status")).toHaveTextContent("Carregando regras...");
  expect(await screen.findByRole("heading", { level: 3, name: "Mercado" })).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("erro ao carregar mostra o aviso e tenta de novo", async () => {
  const api = renderPage({ rules: [rule()] });
  api.state.listError = true;
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  api.state.listError = false;
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("heading", { level: 3, name: "Mercado" })).toBeInTheDocument();
});

it("o cartao resume gatilhos e acoes com os nomes de cada item", async () => {
  renderPage({
    rules: [
      rule({
        triggers: [
          { field: "description", op: "contains", value: "mercado" },
          { field: "amount", op: "greater_than", value: "100.50" },
          { field: "account", op: "is", value: account.id },
          { field: "type", op: "is", value: "withdrawal" },
        ],
        actions: [
          { kind: "set_category", target_id: category.id },
          { kind: "add_tag", target_id: tag.id },
          { kind: "set_budget", target_id: budget.id },
          { kind: "set_bill", target_id: bill.id },
        ],
      }),
    ],
  });
  const item = card(await screen.findByRole("heading", { level: 3, name: "Mercado" }).then(() => "Mercado"));
  for (const text of [
    'Descrição contém "mercado"',
    "Valor é maior que 100,50",
    "Conta é Nubank",
    "Tipo é Saída",
    "Categoria: Mercado",
    "Tag: casa",
    "Orçamento: Casa",
    "Conta a pagar: Netflix",
  ]) {
    expect(within(item).getByText(text)).toBeInTheDocument();
  }
  expect(within(item).getByText("Quando todos valerem")).toBeInTheDocument();
});

it("regra com qualquer gatilho, pausada e que para aqui mostra os avisos", async () => {
  renderPage({ rules: [rule({ match_mode: "any", active: false, stop_processing: true })] });
  const item = card(await screen.findByRole("heading", { level: 3, name: "Mercado" }).then(() => "Mercado"));
  expect(within(item).getByText("Quando qualquer um valer")).toBeInTheDocument();
  expect(within(item).getByText("Pausada")).toBeInTheDocument();
  expect(within(item).getByText("Para aqui")).toBeInTheDocument();
});

it("alvo que nao existe mais aparece como item removido", async () => {
  renderPage({ rules: [rule({ actions: [{ kind: "set_category", target_id: "sumiu" }] })] });
  expect(await screen.findByText("Categoria: item removido")).toBeInTheDocument();
});

it("agrupa as regras por grupo e deixa as sem grupo no fim", async () => {
  const group = makeRuleGroup({ name: "Casa" });
  renderPage({
    groups: [group, makeRuleGroup({ name: "Vazio", position: 1 })],
    rules: [rule({ name: "Do grupo", group_id: group.id }), rule({ name: "Solta" })],
  });
  await screen.findByRole("heading", { level: 3, name: "Do grupo" });
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings).toEqual(["Casa (1)", "Vazio (0)", "Sem grupo"]);
  expect(within(screen.getByRole("region", { name: "Grupo Casa" })).getByText("Do grupo")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Regras sem grupo" })).getByText("Solta")).toBeInTheDocument();
  expect(screen.getByText("Este grupo ainda não tem regras.")).toBeInTheDocument();
});

it("sem nenhum grupo as regras aparecem sem o titulo Sem grupo", async () => {
  renderPage({ rules: [rule()] });
  await screen.findByRole("heading", { level: 3, name: "Mercado" });
  expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
});

it("so grupos, sem regras, nao mostra o estado vazio", async () => {
  renderPage({ groups: [makeRuleGroup({ name: "Casa" })] });
  expect(await screen.findByRole("heading", { level: 2, name: "Casa (0)" })).toBeInTheDocument();
  expect(screen.queryByText("Nenhuma regra ainda")).not.toBeInTheDocument();
});

// ---------- Pausar, ativar e excluir ----------

it("pausar manda so active false e ativar manda true", async () => {
  const api = renderPage({ rules: [rule()] });
  await screen.findByRole("heading", { level: 3, name: "Mercado" });
  await openMenu("Ações da regra Mercado");
  await userEvent.click(screen.getByRole("menuitem", { name: "Pausar" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0]).toMatchObject({ method: "PATCH", body: { active: false } });
  expect(await screen.findByText("Pausada")).toBeInTheDocument();

  await openMenu("Ações da regra Mercado");
  await userEvent.click(screen.getByRole("menuitem", { name: "Ativar" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(2));
  expect(api.mutations()[1].body).toEqual({ active: true });
  await waitFor(() => expect(screen.queryByText("Pausada")).not.toBeInTheDocument());
});

it("erro ao pausar mostra o aviso e nao muda a regra", async () => {
  const api = renderPage({ rules: [rule()] });
  await screen.findByRole("heading", { level: 3, name: "Mercado" });
  api.state.nextMutationError = { status: 404, code: "rule_not_found" };
  await openMenu("Ações da regra Mercado");
  await userEvent.click(screen.getByRole("menuitem", { name: "Pausar" }));
  expect(await screen.findByText("Regra não encontrada.")).toBeInTheDocument();
  expect(screen.queryByText("Pausada")).not.toBeInTheDocument();
});

it("excluir pede confirmacao, avisa o que acontece e so apaga ao confirmar", async () => {
  const api = renderPage({ rules: [rule()] });
  await screen.findByRole("heading", { level: 3, name: "Mercado" });
  await openMenu("Ações da regra Mercado");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  expect(inDialog().getByText(/continuam como estão/)).toBeInTheDocument();
  await userEvent.click(inDialog().getByRole("button", { name: "Cancelar" }));
  expect(api.mutations()).toHaveLength(0);

  await openMenu("Ações da regra Mercado");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  await userEvent.click(inDialog().getByRole("button", { name: "Excluir" }));
  await waitFor(() => expect(api.mutations()).toEqual([{ method: "DELETE", path: expect.stringContaining("/rules/") }]));
  expect(await screen.findByText("Nenhuma regra ainda")).toBeInTheDocument();
});

// ---------- Grupos ----------

it("criar grupo manda nome e ordem e ele aparece na lista", async () => {
  const api = renderPage({ rules: [rule()] });
  await screen.findByRole("heading", { level: 3, name: "Mercado" });
  await userEvent.click(screen.getByRole("button", { name: "Novo grupo" }));
  await userEvent.type(inDialog().getByLabelText("Nome"), "  Casa  ");
  await userEvent.clear(inDialog().getByLabelText("Ordem"));
  await userEvent.type(inDialog().getByLabelText("Ordem"), "3");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar grupo" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0]).toMatchObject({ method: "POST", path: "/rule-groups", body: { name: "Casa", position: 3 } });
  expect(await screen.findByRole("heading", { level: 2, name: "Casa (0)" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("grupo sem nome ou com ordem invalida mostra o erro e nao envia", async () => {
  const api = renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await userEvent.click(screen.getByRole("button", { name: "Novo grupo" }));
  await userEvent.clear(inDialog().getByLabelText("Ordem"));
  await userEvent.type(inDialog().getByLabelText("Ordem"), "x");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar grupo" }));
  expect(await inDialog().findByText("Informe o nome do grupo.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe um número inteiro de 0 a 100000.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it("nome de grupo repetido mostra o erro no campo", async () => {
  renderPage({ groups: [makeRuleGroup({ name: "Casa" })] });
  await screen.findByRole("heading", { level: 2, name: "Casa (0)" });
  await userEvent.click(screen.getByRole("button", { name: "Novo grupo" }));
  await userEvent.type(inDialog().getByLabelText("Nome"), "casa");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar grupo" }));
  expect(await inDialog().findByText("Já existe um grupo de regras com esse nome.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
});

it("editar grupo manda so o que mudou e sem mudanca nao envia nada", async () => {
  const group = makeRuleGroup({ name: "Casa", position: 2 });
  const api = renderPage({ groups: [group] });
  await screen.findByRole("heading", { level: 2, name: "Casa (0)" });
  await openMenu("Ações do grupo Casa");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  expect(api.mutations()).toHaveLength(0);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await openMenu("Ações do grupo Casa");
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  await userEvent.clear(inDialog().getByLabelText("Nome"));
  await userEvent.type(inDialog().getByLabelText("Nome"), "Contas");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ name: "Contas" });
  expect(await screen.findByRole("heading", { level: 2, name: "Contas (0)" })).toBeInTheDocument();
});

it("excluir grupo avisa que as regras ficam sem grupo e solta as regras", async () => {
  const group = makeRuleGroup({ name: "Casa" });
  const api = renderPage({ groups: [group], rules: [rule({ group_id: group.id })] });
  await screen.findByRole("heading", { level: 3, name: "Mercado" });
  await openMenu("Ações do grupo Casa");
  await userEvent.click(screen.getByRole("menuitem", { name: "Excluir" }));
  expect(inDialog().getByText(/só ficam sem grupo/)).toBeInTheDocument();
  await userEvent.click(inDialog().getByRole("button", { name: "Excluir" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].method).toBe("DELETE");
  await waitFor(() => expect(screen.queryByRole("heading", { level: 2, name: "Casa (1)" })).not.toBeInTheDocument());
  expect(screen.getByRole("heading", { level: 3, name: "Mercado" })).toBeInTheDocument();
});

// ---------- Formulario da regra: criar ----------

async function openNewRule() {
  await userEvent.click(screen.getAllByRole("button", { name: "Nova regra" })[0]);
}

it("cria uma regra com gatilho de descricao e acao de categoria", async () => {
  const api = renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  await userEvent.type(inDialog().getByLabelText("Nome"), "  Mercado  ");
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "  mercado ");
  await userEvent.selectOptions(select("Alvo da ação 1"), "Mercado");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar regra" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({
    name: "Mercado",
    group_id: null,
    position: 0,
    match_mode: "all",
    stop_processing: false,
    active: true,
    triggers: [{ field: "description", op: "contains", value: "mercado" }],
    actions: [{ kind: "set_category", target_id: category.id }],
  });
  expect(await screen.findByRole("heading", { level: 3, name: "Mercado" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("monta uma regra completa: varios gatilhos, grupo, ordem, qualquer e parar", async () => {
  const group = makeRuleGroup({ name: "Casa" });
  const api = renderPage({ groups: [group] });
  await screen.findByRole("heading", { level: 2, name: "Casa (0)" });
  await openNewRule();
  await userEvent.type(inDialog().getByLabelText("Nome"), "Completa");
  await userEvent.selectOptions(inDialog().getByLabelText("Combinação dos gatilhos"), "Basta um gatilho valer");

  await userEvent.selectOptions(select("Campo do gatilho 1"), "Quem recebeu ou pagou");
  await userEvent.selectOptions(select("Operação do gatilho 1"), "começa com");
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "super");

  await userEvent.click(inDialog().getByRole("button", { name: "Adicionar gatilho" }));
  await userEvent.selectOptions(select("Campo do gatilho 2"), "Valor");
  await userEvent.selectOptions(select("Operação do gatilho 2"), "é menor que");
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 2"), "1.234,50");

  await userEvent.click(inDialog().getByRole("button", { name: "Adicionar gatilho" }));
  await userEvent.selectOptions(select("Campo do gatilho 3"), "Conta");
  await userEvent.selectOptions(select("Valor do gatilho 3"), "Nubank");

  await userEvent.click(inDialog().getByRole("button", { name: "Adicionar gatilho" }));
  await userEvent.selectOptions(select("Campo do gatilho 4"), "Tipo");
  await userEvent.selectOptions(select("Valor do gatilho 4"), "Entrada");

  await userEvent.selectOptions(select("Alvo da ação 1"), "Lazer");
  await userEvent.click(inDialog().getByRole("button", { name: "Adicionar ação" }));
  await userEvent.selectOptions(select("Ação 2"), "Adicionar tag");
  await userEvent.selectOptions(select("Alvo da ação 2"), "casa");
  await userEvent.click(inDialog().getByRole("button", { name: "Adicionar ação" }));
  await userEvent.selectOptions(select("Ação 3"), "Ligar ao orçamento");
  await userEvent.selectOptions(select("Alvo da ação 3"), "Casa");
  await userEvent.click(inDialog().getByRole("button", { name: "Adicionar ação" }));
  await userEvent.selectOptions(select("Ação 4"), "Ligar à conta a pagar");
  await userEvent.selectOptions(select("Alvo da ação 4"), "Netflix");

  await userEvent.selectOptions(inDialog().getByLabelText("Grupo"), "Casa");
  await userEvent.clear(inDialog().getByLabelText("Ordem"));
  await userEvent.type(inDialog().getByLabelText("Ordem"), "5");
  await userEvent.click(inDialog().getByLabelText(/Parar aqui/));
  await userEvent.click(inDialog().getByLabelText("Regra ativa"));
  await userEvent.click(inDialog().getByRole("button", { name: "Criar regra" }));

  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({
    name: "Completa",
    group_id: group.id,
    position: 5,
    match_mode: "any",
    stop_processing: true,
    active: false,
    triggers: [
      { field: "counterparty", op: "starts_with", value: "super" },
      { field: "amount", op: "less_than", value: "1234.50" },
      { field: "account", op: "is", value: account.id },
      { field: "type", op: "is", value: "deposit" },
    ],
    actions: [
      { kind: "set_category", target_id: otherCategory.id },
      { kind: "add_tag", target_id: tag.id },
      { kind: "set_budget", target_id: budget.id },
      { kind: "set_bill", target_id: bill.id },
    ],
  });
});

it("trocar o campo do gatilho troca as operacoes e zera o valor", async () => {
  renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "texto");
  await userEvent.selectOptions(select("Campo do gatilho 1"), "Valor");
  const ops = within(select("Operação do gatilho 1")).getAllByRole("option").map((o) => o.textContent);
  expect(ops).toEqual(["é maior que", "é menor que", "é igual a"]);
  expect(inDialog().getByLabelText("Valor do gatilho 1")).toHaveValue("");
  await userEvent.selectOptions(select("Campo do gatilho 1"), "Conta");
  expect(within(select("Operação do gatilho 1")).getAllByRole("option").map((o) => o.textContent)).toEqual(["é"]);
  await userEvent.selectOptions(select("Campo do gatilho 1"), "Tipo");
  expect(select("Valor do gatilho 1")).toHaveValue("withdrawal");
});

it("mostra os erros de cada linha e nao envia", async () => {
  const api = renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  await userEvent.click(inDialog().getByRole("button", { name: "Criar regra" }));
  expect(await inDialog().findByText("Informe o nome da regra.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe o texto.")).toBeInTheDocument();
  expect(inDialog().getByText("Escolha a categoria.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);

  await userEvent.type(inDialog().getByLabelText("Nome"), "x");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar regra" }));
  expect(inDialog().queryByText("Informe o nome da regra.")).not.toBeInTheDocument();
  expect(inDialog().getByLabelText("Valor do gatilho 1")).toHaveFocus();
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "a");
  expect(inDialog().queryByText("Informe o texto.")).not.toBeInTheDocument();
});

it("foca a acao sem alvo quando o resto esta certo", async () => {
  renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  await userEvent.type(inDialog().getByLabelText("Nome"), "x");
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "a");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar regra" }));
  expect(select("Alvo da ação 1")).toHaveFocus();
});

it("valor invalido e ordem invalida sao recusados", async () => {
  const api = renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  await userEvent.type(inDialog().getByLabelText("Nome"), "x");
  await userEvent.selectOptions(select("Campo do gatilho 1"), "Valor");
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "abc");
  await userEvent.selectOptions(select("Alvo da ação 1"), "Mercado");
  await userEvent.clear(inDialog().getByLabelText("Ordem"));
  await userEvent.type(inDialog().getByLabelText("Ordem"), "-2");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar regra" }));
  expect(await inDialog().findByText("Valor inválido.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe um número inteiro de 0 a 100000.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Ordem")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it("nao deixa remover o unico gatilho nem a unica acao", async () => {
  renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  expect(inDialog().getByRole("button", { name: "Remover gatilho 1" })).toBeDisabled();
  expect(inDialog().getByRole("button", { name: "Remover ação 1" })).toBeDisabled();
  await userEvent.click(inDialog().getByRole("button", { name: "Adicionar gatilho" }));
  expect(inDialog().getByRole("button", { name: "Remover gatilho 1" })).toBeEnabled();
  await userEvent.click(inDialog().getByRole("button", { name: "Remover gatilho 2" }));
  expect(inDialog().queryByLabelText("Valor do gatilho 2")).not.toBeInTheDocument();
});

it("remover um gatilho do meio mantem os valores dos outros", async () => {
  renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "um");
  await userEvent.click(inDialog().getByRole("button", { name: "Adicionar gatilho" }));
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 2"), "dois");
  await userEvent.click(inDialog().getByRole("button", { name: "Adicionar gatilho" }));
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 3"), "tres");
  await userEvent.click(inDialog().getByRole("button", { name: "Remover gatilho 2" }));
  expect(inDialog().getByLabelText("Valor do gatilho 1")).toHaveValue("um");
  expect(inDialog().getByLabelText("Valor do gatilho 2")).toHaveValue("tres");
});

it("o limite de 10 gatilhos e 10 acoes desabilita os botoes de adicionar", async () => {
  renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  for (let i = 0; i < 9; i += 1) {
    await userEvent.click(inDialog().getByRole("button", { name: "Adicionar gatilho" }));
    await userEvent.click(inDialog().getByRole("button", { name: "Adicionar ação" }));
  }
  expect(inDialog().getByRole("button", { name: "Adicionar gatilho" })).toBeDisabled();
  expect(inDialog().getByRole("button", { name: "Adicionar ação" })).toBeDisabled();
});

it("acao de alvo unico ja usada em outra linha fica desabilitada", async () => {
  renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  await userEvent.click(inDialog().getByRole("button", { name: "Adicionar ação" }));
  // A linha 2 ja nasce com a proxima acao livre (orcamento)
  expect(select("Ação 2")).toHaveValue("set_budget");
  const optionsOfFirst = within(select("Ação 1")).getAllByRole("option") as HTMLOptionElement[];
  expect(optionsOfFirst.find((o) => o.value === "set_budget")?.disabled).toBe(true);
  expect(optionsOfFirst.find((o) => o.value === "add_tag")?.disabled).toBe(false);
  expect(optionsOfFirst.find((o) => o.value === "set_category")?.disabled).toBe(false);
});

it("trocar o tipo da acao zera o alvo escolhido", async () => {
  renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  await userEvent.selectOptions(select("Alvo da ação 1"), "Mercado");
  await userEvent.selectOptions(select("Ação 1"), "Adicionar tag");
  expect(select("Alvo da ação 1")).toHaveValue("");
  expect(within(select("Alvo da ação 1")).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Escolha",
    "casa",
    "viagem",
  ]);
});

it("a mesma tag duas vezes e recusada", async () => {
  const api = renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  await userEvent.type(inDialog().getByLabelText("Nome"), "x");
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "a");
  await userEvent.selectOptions(select("Ação 1"), "Adicionar tag");
  await userEvent.selectOptions(select("Alvo da ação 1"), "casa");
  await userEvent.click(inDialog().getByRole("button", { name: "Adicionar ação" }));
  await userEvent.selectOptions(select("Ação 2"), "Adicionar tag");
  await userEvent.selectOptions(select("Alvo da ação 2"), "casa");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar regra" }));
  expect(await inDialog().findByText("Essa tag já foi escolhida.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("nome de regra repetido mostra o erro no campo nome", async () => {
  renderPage({ rules: [rule({ name: "Mercado" })] });
  await screen.findByRole("heading", { level: 3, name: "Mercado" });
  await openNewRule();
  await userEvent.type(inDialog().getByLabelText("Nome"), "MERCADO");
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "a");
  await userEvent.selectOptions(select("Alvo da ação 1"), "Mercado");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar regra" }));
  expect(await inDialog().findByText("Já existe uma regra com esse nome.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveFocus();
});

it("erro inesperado do servidor aparece no topo do formulario", async () => {
  const api = renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  await userEvent.type(inDialog().getByLabelText("Nome"), "x");
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "a");
  await userEvent.selectOptions(select("Alvo da ação 1"), "Mercado");
  api.state.nextMutationError = { status: 422, code: "rule_invalid" };
  await userEvent.click(inDialog().getByRole("button", { name: "Criar regra" }));
  expect(await inDialog().findByText(/cita algo que não existe mais/)).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

// ---------- Formulario da regra: editar ----------

async function openEdit(name = "Mercado") {
  await screen.findByRole("heading", { level: 3, name });
  await openMenu(`Ações da regra ${name}`);
  await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
}

it("editar preenche o formulario com a regra, valor com virgula", async () => {
  const group = makeRuleGroup({ name: "Casa" });
  renderPage({
    groups: [group],
    rules: [
      rule({
        name: "Grande",
        group_id: group.id,
        position: 4,
        match_mode: "any",
        stop_processing: true,
        active: false,
        triggers: [{ field: "amount", op: "greater_than", value: "1000.50" }],
        actions: [{ kind: "add_tag", target_id: tag.id }],
      }),
    ],
  });
  await openEdit("Grande");
  expect(inDialog().getByRole("heading", { name: "Editar regra" })).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveValue("Grande");
  expect(inDialog().getByLabelText("Combinação dos gatilhos")).toHaveValue("any");
  expect(select("Campo do gatilho 1")).toHaveValue("amount");
  expect(select("Operação do gatilho 1")).toHaveValue("greater_than");
  expect(inDialog().getByLabelText("Valor do gatilho 1")).toHaveValue("1000,50");
  expect(select("Ação 1")).toHaveValue("add_tag");
  await waitFor(() => expect(select("Alvo da ação 1")).toHaveValue(tag.id));
  await waitFor(() => expect(inDialog().getByLabelText("Grupo")).toHaveValue(group.id));
  expect(inDialog().getByLabelText("Ordem")).toHaveValue("4");
  expect(inDialog().getByLabelText(/Parar aqui/)).toBeChecked();
  expect(inDialog().getByLabelText("Regra ativa")).not.toBeChecked();
});

it("salvar sem mudar nada nao envia nada", async () => {
  const api = renderPage({ rules: [rule()] });
  await openEdit();
  await waitFor(() => expect(select("Alvo da ação 1")).toHaveValue(category.id));
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  expect(api.mutations()).toHaveLength(0);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("editar manda so o que mudeu", async () => {
  const api = renderPage({ rules: [rule()] });
  await openEdit();
  await waitFor(() => expect(select("Alvo da ação 1")).toHaveValue(category.id));
  await userEvent.clear(inDialog().getByLabelText("Nome"));
  await userEvent.type(inDialog().getByLabelText("Nome"), "Super");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0]).toMatchObject({ method: "PATCH", body: { name: "Super" } });
  expect(await screen.findByRole("heading", { level: 3, name: "Super" })).toBeInTheDocument();
});

it("tirar a regra do grupo manda group_id null", async () => {
  const group = makeRuleGroup({ name: "Casa" });
  const api = renderPage({ groups: [group], rules: [rule({ group_id: group.id })] });
  await openEdit();
  await waitFor(() => expect(inDialog().getByLabelText("Grupo")).toHaveValue(group.id));
  await userEvent.selectOptions(inDialog().getByLabelText("Grupo"), "Sem grupo");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ group_id: null });
});

it("trocar gatilho e acao manda as listas inteiras", async () => {
  const api = renderPage({ rules: [rule()] });
  await openEdit();
  await waitFor(() => expect(select("Alvo da ação 1")).toHaveValue(category.id));
  await userEvent.clear(inDialog().getByLabelText("Valor do gatilho 1"));
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "padaria");
  await userEvent.selectOptions(select("Alvo da ação 1"), "Lazer");
  await userEvent.click(inDialog().getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({
    triggers: [{ field: "description", op: "contains", value: "padaria" }],
    actions: [{ kind: "set_category", target_id: otherCategory.id }],
  });
});

it("cancelar fecha o formulario sem enviar", async () => {
  const api = renderPage({ rules: [rule()] });
  await openEdit();
  await userEvent.click(inDialog().getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("depois de trocar o tipo da acao o alvo antigo nao vai junto: pede a escolha de novo", async () => {
  const api = renderPage();
  await screen.findByText("Nenhuma regra ainda");
  await openNewRule();
  await userEvent.type(inDialog().getByLabelText("Nome"), "x");
  await userEvent.type(inDialog().getByLabelText("Valor do gatilho 1"), "a");
  await userEvent.selectOptions(select("Alvo da ação 1"), "Mercado");
  await userEvent.selectOptions(select("Ação 1"), "Adicionar tag");
  await userEvent.click(inDialog().getByRole("button", { name: "Criar regra" }));
  expect(await inDialog().findByText("Escolha a tag.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});
