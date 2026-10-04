import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBillsApi } from "@/test-utils/bills-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeEnvelopesApi, makeEnvelope } from "@/test-utils/envelopes-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import EnvelopesPage from "./envelopes";

// Data fixa: o mes mostrado ao abrir e o botao "Mes atual" dependem de hoje
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 15, 12));
});
afterEach(() => vi.useRealTimers());

function renderPage(envelopes: ReturnType<typeof makeEnvelope>[] = [], options: Parameters<typeof fakeEnvelopesApi>[1] = {}) {
  const api = fakeEnvelopesApi(envelopes, options);
  server.use(...api.handlers, ...fakeAccountsApi([makeAccount()]).handlers, ...fakeBudgetsApi().handlers, ...fakeBillsApi().handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <EnvelopesPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const user = userEvent.setup();
const money = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const row = (name: string) => screen.getByRole("rowheader", { name }).closest("tr") as HTMLElement;
const allocationField = (name: string) => screen.getByLabelText(`Distribuído para ${name}`) as HTMLInputElement;
const toBudget = () => money(screen.getByLabelText("A orçar em BRL").textContent);
const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());
// Os dois selects do mover tem as mesmas opcoes: a busca e sempre dentro do campo escolhido
const pick = (label: string, name: string | RegExp) => {
  const select = inDialog().getByLabelText(label);
  return user.selectOptions(select, within(select).getByRole("option", { name }));
};

const trio = () => [
  makeEnvelope("Mercado", { allocated: 300, spent: 120 }),
  makeEnvelope("Lazer", { allocated: 100 }),
  makeEnvelope("Reserva", { carried: 50 }),
];

// ---------- Estados ----------

it("sem envelopes mostra o estado vazio e oferece criar", async () => {
  renderPage();
  expect(await screen.findByText("Nenhum envelope ainda")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Novo envelope" }).length).toBeGreaterThan(0);
  expect(screen.queryByLabelText(/A orçar em/)).not.toBeInTheDocument();
});

it("falha ao carregar mostra o erro e permite tentar de novo", async () => {
  const api = renderPage(trio());
  api.state.viewError = true;
  expect(await screen.findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");
  api.state.viewError = false;
  await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("rowheader", { name: "Mercado" })).toBeInTheDocument();
});

it("abre no mes de hoje e pede esse mes ao servidor", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  expect(screen.getByText(/março de 2026/i)).toBeInTheDocument();
  expect(api.state.requests.at(-1)?.month).toBe("2026-03");
});

it("mostra o A orcar, o dinheiro e o que esta nos envelopes", async () => {
  renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  // Disponivel: Mercado 180, Lazer 100, Reserva 50 = 330 nos envelopes; dinheiro 1000
  expect(toBudget()).toBe("R$ 670,00");
  const group = screen.getByRole("region", { name: "Envelopes em BRL" });
  expect(money(group.textContent)).toContain("Dinheiro nas contas: R$ 1.000,00");
  expect(money(group.textContent)).toContain("Nos envelopes: R$ 330,00");
  expect(screen.getByText("Dinheiro que ainda não está em nenhum envelope.")).toBeInTheDocument();
});

it("cada linha mostra o que passou, o distribuido, o gasto e o disponivel", async () => {
  renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  const reserve = row("Reserva");
  expect(money(within(reserve).getAllByRole("cell")[0].textContent)).toBe("R$ 50,00");
  expect(allocationField("Mercado").value).toBe("300,00");
  const market = row("Mercado");
  expect(money(within(market).getAllByRole("cell")[2].textContent)).toBe("R$ 120,00");
  expect(money(within(market).getAllByRole("cell")[3].textContent)).toContain("R$ 180,00");
});

it("A orcar negativo vira alerta com texto, nao so cor", async () => {
  renderPage([makeEnvelope("Tudo", { allocated: 1500 })]);
  await screen.findByRole("rowheader", { name: "Tudo" });
  expect(toBudget()).toBe("-R$ 500,00");
  expect(screen.getByLabelText("A orçar em BRL")).toHaveClass("text-destructive");
  expect(screen.getByText(/Você distribuiu mais do que tem/)).toBeInTheDocument();
});

it("A orcar zerado diz que esta tudo distribuido", async () => {
  renderPage([makeEnvelope("Tudo", { allocated: 1000 })]);
  await screen.findByRole("rowheader", { name: "Tudo" });
  expect(screen.getByText("Tudo distribuído.")).toBeInTheDocument();
});

it("envelope estourado e envelope zerado aparecem com rotulo", async () => {
  renderPage([makeEnvelope("Passou", { allocated: 100, spent: 130 }), makeEnvelope("Quitado", { allocated: 50, spent: 50 }), makeEnvelope("Bom", { allocated: 100 })]);
  await screen.findByRole("rowheader", { name: "Passou" });
  expect(within(row("Passou")).getByText("Estourou")).toBeInTheDocument();
  expect(within(row("Quitado")).getByText("Zerado")).toBeInTheDocument();
  expect(within(row("Bom")).queryByText("Estourou")).not.toBeInTheDocument();
  expect(within(row("Bom")).queryByText("Zerado")).not.toBeInTheDocument();
  expect(money(within(row("Passou")).getByRole("button", { name: /^Cobrir/ }).textContent)).toBe("Cobrir R$ 30,00");
  // So o envelope estourado oferece cobrir
  expect(within(row("Quitado")).queryByRole("button", { name: /^Cobrir/ })).not.toBeInTheDocument();
  expect(within(row("Bom")).queryByRole("button", { name: /^Cobrir/ })).not.toBeInTheDocument();
});

it("distribuir num mes recarrega os outros meses ja visitados (a sobra deste passa para eles)", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(screen.getByRole("button", { name: "Próximo mês" }));
  await waitFor(() => expect(api.state.requests.at(-1)?.month).toBe("2026-04"));
  await user.click(screen.getByRole("button", { name: "Mês anterior" }));
  await screen.findByText(/março de 2026/i);
  const field = allocationField("Lazer");
  await user.clear(field);
  await user.type(field, "20");
  await user.tab();
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  const gets = () => api.state.requests.filter((request) => request.method === "GET" && request.month === "2026-04").length;
  const before = gets();
  await user.click(screen.getByRole("button", { name: "Próximo mês" }));
  await waitFor(() => expect(gets()).toBeGreaterThan(before));
});

// ---------- Mes ----------

it("navega entre os meses e volta para o atual", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  expect(screen.queryByRole("button", { name: "Mês atual" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Próximo mês" }));
  expect(await screen.findByText(/abril de 2026/i)).toBeInTheDocument();
  await waitFor(() => expect(api.state.requests.at(-1)?.month).toBe("2026-04"));
  await user.click(screen.getByRole("button", { name: "Mês anterior" }));
  await user.click(screen.getByRole("button", { name: "Mês anterior" }));
  expect(await screen.findByText(/fevereiro de 2026/i)).toBeInTheDocument();
  await waitFor(() => expect(api.state.requests.at(-1)?.month).toBe("2026-02"));
  await user.click(screen.getByRole("button", { name: "Mês atual" }));
  expect(await screen.findByText(/março de 2026/i)).toBeInTheDocument();
});

it("passa de dezembro para janeiro", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  for (let n = 0; n < 10; n += 1) await user.click(screen.getByRole("button", { name: "Próximo mês" }));
  expect(await screen.findByText(/janeiro de 2027/i)).toBeInTheDocument();
  await waitFor(() => expect(api.state.requests.at(-1)?.month).toBe("2027-01"));
});

// ---------- Distribuir ----------

it("digitar o valor e sair do campo distribui e o A orcar acompanha", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  const field = allocationField("Lazer");
  await user.clear(field);
  await user.type(field, "250,50");
  await user.tab();
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0]).toMatchObject({ method: "PUT", body: { amount: "250.50" } });
  expect(api.mutations()[0].path).toMatch(/\/envelopes\/.+\/2026-03$/);
  await waitFor(() => expect(toBudget()).toBe("R$ 519,50"));
  expect(allocationField("Lazer").value).toBe("250,50");
});

it("Enter tambem confirma", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  const field = allocationField("Lazer");
  await user.clear(field);
  await user.type(field, "10{Enter}");
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ amount: "10.00" });
});

it("sair do campo sem mudar nada nao chama a API", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(allocationField("Mercado"));
  await user.tab();
  expect(api.mutations()).toHaveLength(0);
});

it("campo vazio limpa a distribuicao (manda zero)", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.clear(allocationField("Lazer"));
  await user.tab();
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  expect(api.mutations()[0].body).toEqual({ amount: "0" });
});

it("valor negativo tira do que passou do mes anterior", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  const field = allocationField("Reserva");
  await user.clear(field);
  await user.type(field, "-20");
  await user.tab();
  await waitFor(() => expect(api.mutations()[0].body).toEqual({ amount: "-20.00" }));
});

it("valor invalido mostra o aviso no campo e nao chama a API", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  const field = allocationField("Lazer");
  await user.clear(field);
  await user.type(field, "abc");
  await user.tab();
  expect(await within(row("Lazer")).findByRole("alert")).toHaveTextContent("Valor inválido");
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(api.mutations()).toHaveLength(0);
  await user.type(field, "1");
  expect(within(row("Lazer")).queryByRole("alert")).not.toBeInTheDocument();
});

it("falha do servidor ao distribuir aparece no aviso do topo e o campo volta ao valor anterior", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  api.state.nextMutationError = { status: 500, code: "internal_error" };
  const field = allocationField("Lazer");
  await user.clear(field);
  await user.type(field, "55");
  await user.tab();
  expect(await screen.findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");
  await waitFor(() => expect(allocationField("Lazer").value).toBe("100,00"));
});

// ---------- Mover ----------

it("o botao de mover so existe com mais de um envelope", async () => {
  renderPage([makeEnvelope("Sozinho", { allocated: 10 })]);
  await screen.findByRole("rowheader", { name: "Sozinho" });
  expect(screen.queryByRole("button", { name: "Mover dinheiro" })).not.toBeInTheDocument();
});

it("move dinheiro de um envelope para outro e atualiza a tabela", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(screen.getByRole("button", { name: "Mover dinheiro" }));
  await pick("Tirar de", /^Mercado/);
  await pick("Levar para", "Lazer");
  await user.type(inDialog().getByLabelText("Valor (BRL)"), "80,00");
  await user.click(inDialog().getByRole("button", { name: "Mover" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()[0]).toMatchObject({ method: "POST", path: "/envelopes/move" });
  expect(api.mutations()[0].body).toMatchObject({ month: "2026-03", amount: "80.00" });
  expect(allocationField("Mercado").value).toBe("220,00");
  expect(allocationField("Lazer").value).toBe("180,00");
  expect(toBudget()).toBe("R$ 670,00");
});

it("a lista de origem mostra quanto cada envelope tem disponivel", async () => {
  renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(screen.getByRole("button", { name: "Mover dinheiro" }));
  const options = inDialog().getAllByRole("option").map((option) => money(option.textContent));
  expect(options).toContain("Mercado (R$ 180,00 disponível)");
  expect(options).toContain("Reserva (R$ 50,00 disponível)");
});

it("campos vazios mostram os tres avisos e nao chamam a API", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(screen.getByRole("button", { name: "Mover dinheiro" }));
  await user.click(inDialog().getByRole("button", { name: "Mover" }));
  expect(inDialog().getByText("Escolha de onde tirar.")).toBeInTheDocument();
  expect(inDialog().getByText("Escolha para onde levar.")).toBeInTheDocument();
  expect(inDialog().getByText("Informe o valor.")).toBeInTheDocument();
  expect(inDialog().getByLabelText("Tirar de")).toHaveFocus();
  expect(api.mutations()).toHaveLength(0);
});

it("recusa o mesmo envelope nos dois lados", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(screen.getByRole("button", { name: "Mover dinheiro" }));
  await pick("Tirar de", /^Mercado/);
  await pick("Levar para", "Mercado");
  await user.type(inDialog().getByLabelText("Valor (BRL)"), "10");
  await user.click(inDialog().getByRole("button", { name: "Mover" }));
  expect(inDialog().getByText("Escolha um envelope diferente do de origem.")).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
});

it("zero e valor maior que o disponivel sao recusados no navegador", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(screen.getByRole("button", { name: "Mover dinheiro" }));
  await pick("Tirar de", /^Reserva/);
  await pick("Levar para", "Lazer");
  await user.type(inDialog().getByLabelText("Valor (BRL)"), "0");
  await user.click(inDialog().getByRole("button", { name: "Mover" }));
  expect(inDialog().getByText("Informe um valor maior que zero.")).toBeInTheDocument();
  await user.clear(inDialog().getByLabelText("Valor (BRL)"));
  await user.type(inDialog().getByLabelText("Valor (BRL)"), "50,01");
  await user.click(inDialog().getByRole("button", { name: "Mover" }));
  expect(inDialog().getByText(/só tem R\$.50,00 disponível/)).toBeInTheDocument();
  expect(api.mutations()).toHaveLength(0);
  // Exatamente o que tem, pode
  await user.clear(inDialog().getByLabelText("Valor (BRL)"));
  await user.type(inDialog().getByLabelText("Valor (BRL)"), "50,00");
  await user.click(inDialog().getByRole("button", { name: "Mover" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
});

it("erro do servidor ao mover aparece no campo do valor", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(screen.getByRole("button", { name: "Mover dinheiro" }));
  await pick("Tirar de", /^Mercado/);
  await pick("Levar para", "Lazer");
  await user.type(inDialog().getByLabelText("Valor (BRL)"), "10");
  api.state.nextMutationError = { status: 400, code: "envelope_not_enough" };
  await user.click(inDialog().getByRole("button", { name: "Mover" }));
  expect(await inDialog().findByText("O envelope de origem não tem esse valor disponível.")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("cancelar o mover fecha sem chamar a API", async () => {
  const api = renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(screen.getByRole("button", { name: "Mover dinheiro" }));
  await user.click(inDialog().getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.mutations()).toHaveLength(0);
});

// ---------- Cobrir estouro ----------

it("Cobrir abre o mover ja levando para o envelope que estourou", async () => {
  const api = renderPage([makeEnvelope("Passou", { allocated: 100, spent: 130 }), makeEnvelope("Reserva", { allocated: 200 })]);
  await screen.findByRole("rowheader", { name: "Passou" });
  await user.click(within(row("Passou")).getByRole("button", { name: /^Cobrir/ }));
  expect((inDialog().getByLabelText("Levar para") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Passou");
  await pick("Tirar de", /^Reserva/);
  await user.type(inDialog().getByLabelText("Valor (BRL)"), "30");
  await user.click(inDialog().getByRole("button", { name: "Mover" }));
  await waitFor(() => expect(api.mutations()).toHaveLength(1));
  await waitFor(() => expect(within(row("Passou")).queryByText("Estourou")).not.toBeInTheDocument());
  expect(within(row("Passou")).getByText("Zerado")).toBeInTheDocument();
});

// ---------- Criar, editar, excluir ----------

it("Novo envelope abre o formulario ja em modo envelope, sem limite nem periodo", async () => {
  renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(screen.getAllByRole("button", { name: "Novo envelope" })[0]);
  expect(inDialog().getByRole("heading", { name: "Novo envelope" })).toBeInTheDocument();
  expect(inDialog().getByRole("radio", { name: /Envelope/ })).toBeChecked();
  expect(inDialog().queryByLabelText("Limite por período")).not.toBeInTheDocument();
  expect(inDialog().queryByLabelText("Período")).not.toBeInTheDocument();
});

it("o menu da linha oferece Editar e Excluir, e excluir pede confirmacao", async () => {
  renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(screen.getByRole("button", { name: "Ações do envelope Mercado" }));
  expect(screen.getByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Arquivar" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Excluir" }));
  expect(inDialog().getByRole("heading", { name: "Excluir envelope" })).toBeInTheDocument();
  expect(inDialog().getByText("Mercado")).toBeInTheDocument();
  await user.click(inDialog().getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("Editar abre o formulario do envelope com o nome e sem limite", async () => {
  renderPage(trio());
  await screen.findByRole("rowheader", { name: "Mercado" });
  await user.click(screen.getByRole("button", { name: "Ações do envelope Mercado" }));
  await user.click(screen.getByRole("menuitem", { name: "Editar" }));
  expect(inDialog().getByRole("heading", { name: "Editar envelope" })).toBeInTheDocument();
  expect(inDialog().getByLabelText("Nome")).toHaveValue("Mercado");
  expect(inDialog().queryByLabelText("Limite por período")).not.toBeInTheDocument();
  expect(inDialog().queryByRole("radio")).not.toBeInTheDocument();
});
