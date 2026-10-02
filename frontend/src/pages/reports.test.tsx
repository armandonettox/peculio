import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { tokenStore } from "@/auth/token-store";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi, makeBudget } from "@/test-utils/budgets-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { LocationProbe } from "@/test-utils/location-probe";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import {
  fakeReportsApi,
  makeGroup,
  makeMonthly,
  makeRow,
  makeTotals,
  type ReportData,
} from "@/test-utils/reports-api";
import ReportsPage from "./reports";

// Data fixa: "este mes" depende de hoje
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 15, 12));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const nubank = makeAccount({ name: "Nubank" });
const mercado = makeLabel({ name: "Mercado" });
const viagem = makeLabel({ name: "viagem" });
const casa = makeBudget({ name: "Casa" });

function fullData(): Partial<ReportData> {
  return {
    summary: [
      makeTotals(),
      makeTotals({ currency_code: "USD", income: "100.00", expense: "30.00", net: "70.00", count: 2 }),
    ],
    monthly: [
      makeMonthly("BRL", [
        { month: "2026-01", income: "5000.00", expense: "280.50", net: "4719.50", count: 3 },
        { month: "2026-02", income: "0.00", expense: "0.00", net: "0.00", count: 0 },
        { month: "2026-03", income: "0.00", expense: "405.90", net: "-405.90", count: 2 },
      ]),
      makeMonthly("USD", [{ month: "2026-03", income: "100.00", expense: "30.00", net: "70.00", count: 2 }]),
    ],
    category: [
      makeGroup([
        makeRow({ name: "Mercado", expense: "500.50", net: "-500.50", count: 2 }),
        makeRow({ id: null, name: "Sem categoria", expense: "45.90", net: "-45.90" }),
        makeRow({ name: "Salario", income: "5000.00", net: "5000.00" }),
      ]),
      makeGroup([makeRow({ name: "Lazer", expense: "30.00", net: "-30.00" })], { currency_code: "USD" }),
    ],
    tag: [makeGroup([makeRow({ name: "viagem", expense: "500.50" }), makeRow({ id: null, name: "Sem tag", expense: "10.00" })])],
    budget: [makeGroup([makeRow({ id: null, name: "Sem orcamento", expense: "686.40" })])],
    account: [makeGroup([makeRow({ name: "Nubank", income: "5000.00", expense: "686.40" })])],
  };
}

function renderPage(data: Partial<ReportData> = fullData(), path = "/relatorios") {
  const api = fakeReportsApi(data);
  server.use(
    ...api.handlers,
    ...fakeAccountsApi([nubank]).handlers,
    ...fakeLabelsApi("categories", [mercado]).handlers,
    ...fakeLabelsApi("tags", [viagem]).handlers,
    ...fakeBudgetsApi([casa]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter initialEntries={[path]}>
        <ReportsPage />
        <LocationProbe />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const location = () => screen.getByTestId("location").textContent;
const section = (name: string) => screen.getByRole("region", { name });
const lastQuery = (api: ReturnType<typeof fakeReportsApi>, route = "summary") => {
  const all = api.requestsTo(route);
  return all[all.length - 1].query;
};

// ---------- Estados ----------

it("mostra carregando e depois o relatorio", async () => {
  renderPage();
  expect(screen.getByText("Carregando relatório...")).toBeInTheDocument();
  await screen.findByRole("region", { name: "Relatório em BRL" });
  expect(screen.queryByText("Carregando relatório...")).not.toBeInTheDocument();
});

it("mostra estado vazio quando nao ha receita nem despesa no periodo", async () => {
  renderPage({});
  expect(await screen.findByText("Nada neste período")).toBeInTheDocument();
  expect(screen.getByText(/Quando houver receitas ou despesas/)).toBeInTheDocument();
});

it("estado vazio com filtros oferece limpar e mantem o periodo", async () => {
  const api = renderPage({}, `/relatorios?periodo=ano&conta=${nubank.id}`);
  await screen.findByText("Nada neste período");
  expect(screen.getByText(/atende aos filtros escolhidos/)).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0]);
  await waitFor(() => expect(location()).toBe("/relatorios?periodo=ano"));
  await waitFor(() => expect(lastQuery(api).has("account_id")).toBe(false));
});

it("erro mostra a mensagem em portugues e Tentar de novo busca outra vez", async () => {
  const api = renderPage();
  api.state.errors.push({ status: 500, code: "internal_error" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");
  expect(screen.queryByRole("region", { name: "Relatório em BRL" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  await screen.findByRole("region", { name: "Relatório em BRL" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("erro de validacao do servidor mostra a mensagem do codigo", async () => {
  const api = renderPage();
  api.state.errors.push({
    status: 422,
    code: "validation_error",
    errors: [{ field: "date_from", message: "A data inicial nao pode ser depois da data final" }],
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Confira os dados informados.");
});

// ---------- Conteudo ----------

it("mostra um bloco por moeda com receita, despesa e resultado, sem somar moedas", async () => {
  renderPage();
  const brl = await screen.findByRole("region", { name: "Relatório em BRL" });
  expect(within(within(brl).getByRole("group", { name: "Receita em BRL" })).getByText("R$ 5.000,00")).toBeInTheDocument();
  expect(within(within(brl).getByRole("group", { name: "Despesa em BRL" })).getByText("R$ 686,40")).toBeInTheDocument();
  expect(within(within(brl).getByRole("group", { name: "Resultado em BRL" })).getByText("R$ 4.313,60")).toBeInTheDocument();

  const usd = section("Relatório em USD");
  expect(within(within(usd).getByRole("group", { name: "Receita em USD" })).getByText("US$ 100,00")).toBeInTheDocument();
  expect(within(usd).queryByText("R$ 5.000,00")).not.toBeInTheDocument();
});

it("receita e verde, despesa e vermelha e resultado negativo tambem", async () => {
  renderPage({ summary: [makeTotals({ income: "10.00", expense: "50.00", net: "-40.00" })] });
  const brl = await screen.findByRole("region", { name: "Relatório em BRL" });
  expect(within(within(brl).getByRole("group", { name: "Receita em BRL" })).getByText("R$ 10,00")).toHaveClass("text-positive");
  expect(within(within(brl).getByRole("group", { name: "Despesa em BRL" })).getByText("R$ 50,00")).toHaveClass("text-destructive");
  expect(within(within(brl).getByRole("group", { name: "Resultado em BRL" })).getByText("-R$ 40,00")).toHaveClass("text-destructive");
});

it("tabela por categoria tem a linha sem categoria e barras com valor em texto", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Relatório em BRL" });
  const table = within(section("Relatório em BRL")).getByRole("table", { name: "Por categoria em BRL" });
  const rows = within(table).getAllByRole("row");
  // cabecalho + 3 linhas, na ordem recebida (maior gasto primeiro)
  expect(rows).toHaveLength(4);
  expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent("Mercado");
  expect(within(rows[2]).getByRole("rowheader")).toHaveTextContent("Sem categoria");
  expect(within(rows[3]).getByRole("rowheader")).toHaveTextContent("Salario");
  expect(within(rows[1]).getByText("R$ 500,50")).toBeInTheDocument();
  // A maior despesa ocupa a barra toda e as outras proporcionalmente
  const bar = within(rows[1]).getByRole("img");
  // O Intl usa espaco sem quebra depois do R$
  expect(bar.getAttribute("aria-label")?.replace(/\s/g, " ")).toBe("Despesa de R$ 500,50, 100% do maior gasto da lista");
  expect(bar).toHaveStyle({ width: "100%" });
  expect(within(rows[2]).getByRole("img")).toHaveStyle({ width: "9%" });
  // Sem despesa, sem barra
  expect(within(rows[3]).queryByRole("img")).not.toBeInTheDocument();
});

it("tabelas por tag, orcamento e conta usam o texto das linhas sem vinculo", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Relatório em BRL" });
  const brl = within(section("Relatório em BRL"));
  expect(within(brl.getByRole("table", { name: "Por tag em BRL" })).getByText("Sem tag")).toBeInTheDocument();
  expect(within(brl.getByRole("table", { name: "Por orçamento em BRL" })).getByText("Sem orçamento")).toBeInTheDocument();
  expect(within(brl.getByRole("table", { name: "Por conta em BRL" })).getByText("Nubank")).toBeInTheDocument();
  expect(brl.getByText(/Um lançamento com várias tags aparece em cada uma/)).toBeInTheDocument();
});

it("grafico mensal descreve o periodo e a tabela traz todos os meses, inclusive os vazios", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Relatório em BRL" });
  const brl = within(section("Relatório em BRL"));
  expect(
    brl.getByRole("img", { name: /Receita e despesa por mês em BRL, de janeiro de 2026 a março de 2026/ }),
  ).toBeInTheDocument();
  const table = brl.getByRole("table", { name: "Receita, despesa e resultado por mês em BRL" });
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(4);
  expect(within(rows[2]).getByRole("rowheader")).toHaveTextContent("fevereiro de 2026");
  expect(within(rows[3]).getByText("-R$ 405,90")).toHaveClass("text-destructive");
});

it("moeda sem casas decimais aparece sem centavos", async () => {
  renderPage({ summary: [makeTotals({ currency_code: "JPY", income: "0", expense: "1500", net: "-1500", count: 1 })] });
  const jpy = await screen.findByRole("region", { name: "Relatório em JPY" });
  expect(within(within(jpy).getByRole("group", { name: "Despesa em JPY" })).getByText(/1\.500$/)).toBeInTheDocument();
});

// ---------- Periodo e filtros ----------

it("o periodo padrao e este mes, pelo relogio do dia", async () => {
  const api = renderPage();
  await screen.findByRole("region", { name: "Relatório em BRL" });
  const query = lastQuery(api);
  expect(query.get("date_from")).toBe("2026-03-01");
  expect(query.get("date_to")).toBe("2026-03-31");
  expect(screen.getByLabelText("Período")).toHaveValue("this-month");
  expect(location()).toBe("/relatorios");
});

it.each([
  ["Mês passado", "mes-passado", "2026-02-01", "2026-02-28"],
  ["Este ano", "ano", "2026-01-01", "2026-12-31"],
])("periodo %s pede as datas certas e vai para a URL", async (label, param, from, to) => {
  const api = renderPage();
  await screen.findByRole("region", { name: "Relatório em BRL" });
  await userEvent.selectOptions(screen.getByLabelText("Período"), label);
  await waitFor(() => expect(lastQuery(api, "monthly").get("date_from")).toBe(from));
  expect(lastQuery(api, "monthly").get("date_to")).toBe(to);
  expect(lastQuery(api, "by-tag").get("date_from")).toBe(from);
  expect(location()).toBe(`/relatorios?periodo=${param}`);
});

it("mes passado em janeiro usa dezembro do ano anterior", async () => {
  vi.setSystemTime(new Date(2026, 0, 10, 12));
  const api = renderPage({}, "/relatorios?periodo=mes-passado");
  await screen.findByText("Nada neste período");
  expect(lastQuery(api).get("date_from")).toBe("2025-12-01");
  expect(lastQuery(api).get("date_to")).toBe("2025-12-31");
});

it("periodo personalizado mostra as datas e usa o que foi digitado", async () => {
  const api = renderPage();
  await screen.findByRole("region", { name: "Relatório em BRL" });
  expect(screen.queryByLabelText("Data inicial")).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Período"), "Personalizado");
  const from = screen.getByLabelText("Data inicial");
  const to = screen.getByLabelText("Data final");
  await userEvent.type(from, "2026-01-10");
  await userEvent.type(to, "2026-02-20");
  await waitFor(() => expect(lastQuery(api).get("date_to")).toBe("2026-02-20"));
  expect(lastQuery(api).get("date_from")).toBe("2026-01-10");
  expect(location()).toBe("/relatorios?periodo=personalizado&de=2026-01-10&ate=2026-02-20");
});

it("trocar para um periodo pronto descarta as datas personalizadas da URL", async () => {
  renderPage({}, "/relatorios?periodo=personalizado&de=2026-01-10&ate=2026-02-20");
  await screen.findByText("Nada neste período");
  await userEvent.selectOptions(screen.getByLabelText("Período"), "Este ano");
  await waitFor(() => expect(location()).toBe("/relatorios?periodo=ano"));
});

it("data inicial depois da final mostra o erro e nao busca", async () => {
  const api = renderPage({}, "/relatorios?periodo=personalizado&de=2026-03-10&ate=2026-03-01");
  expect(await screen.findByText("A data inicial é depois da data final.")).toBeInTheDocument();
  expect(screen.getByLabelText("Data inicial")).toHaveAttribute("aria-invalid", "true");
  expect(api.state.requests).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
});

it("os filtros vem da URL e vao para todos os relatorios", async () => {
  const api = renderPage(
    fullData(),
    `/relatorios?conta=${nubank.id}&categoria=${mercado.id}&tag=${viagem.id}&orcamento=${casa.id}`,
  );
  await screen.findByRole("region", { name: "Relatório em BRL" });
  for (const route of ["summary", "monthly", "by-category", "by-tag", "by-budget", "by-account"]) {
    const query = lastQuery(api, route);
    expect(query.get("account_id")).toBe(nubank.id);
    expect(query.get("category_id")).toBe(mercado.id);
    expect(query.get("tag_id")).toBe(viagem.id);
    expect(query.get("budget_id")).toBe(casa.id);
  }
  await waitFor(() => expect(screen.getByLabelText("Conta")).toHaveValue(nubank.id));
  expect(screen.getByLabelText("Categoria")).toHaveValue(mercado.id);
  expect(screen.getByLabelText("Tag")).toHaveValue(viagem.id);
  expect(screen.getByLabelText("Orçamento")).toHaveValue(casa.id);
});

it("escolher um filtro atualiza a URL e refaz os pedidos", async () => {
  const api = renderPage();
  await screen.findByRole("region", { name: "Relatório em BRL" });
  await screen.findByRole("option", { name: "Nubank" });
  await userEvent.selectOptions(screen.getByLabelText("Conta"), "Nubank");
  await waitFor(() => expect(lastQuery(api).get("account_id")).toBe(nubank.id));
  expect(location()).toBe(`/relatorios?conta=${nubank.id}`);
  await userEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
  await waitFor(() => expect(location()).toBe("/relatorios"));
  await waitFor(() => expect(lastQuery(api).has("account_id")).toBe(false));
});

// ---------- Exportar CSV ----------

function stubDownload() {
  const createObjectURL = vi.fn(() => "blob:teste");
  const revokeObjectURL = vi.fn();
  // O jsdom nao tem estes dois metodos
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  const downloads: string[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  return { createObjectURL, revokeObjectURL, downloads, click };
}

it("exporta o CSV com o token no cabecalho, os mesmos filtros e sem token na URL", async () => {
  const stub = stubDownload();
  tokenStore.set("token-secreto");
  const api = renderPage(fullData(), `/relatorios?periodo=ano&conta=${nubank.id}&tag=${viagem.id}`);
  await screen.findByRole("region", { name: "Relatório em BRL" });

  await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
  await waitFor(() => expect(stub.downloads).toEqual(["lancamentos-2026-03-15.csv"]));

  const [request] = api.requestsTo("export.csv");
  expect(request.headers.get("Authorization")).toBe("Bearer token-secreto");
  expect(request.query.get("date_from")).toBe("2026-01-01");
  expect(request.query.get("date_to")).toBe("2026-12-31");
  expect(request.query.get("account_id")).toBe(nubank.id);
  expect(request.query.get("tag_id")).toBe(viagem.id);
  expect(JSON.stringify([...request.query.entries()])).not.toContain("token-secreto");
  expect(stub.createObjectURL).toHaveBeenCalledOnce();
  expect(stub.revokeObjectURL).toHaveBeenCalledWith("blob:teste");
  await waitFor(() => expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeEnabled());
});

it("o botao fica desabilitado enquanto exporta", async () => {
  stubDownload();
  renderPage();
  await screen.findByRole("region", { name: "Relatório em BRL" });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { http, HttpResponse } = await import("msw");
  server.use(
    http.get("*/api/v1/transactions/export.csv", async () => {
      await gate;
      return new HttpResponse("a;b", { headers: { "Content-Disposition": 'attachment; filename="x.csv"' } });
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
  expect(await screen.findByRole("button", { name: "Exportando..." })).toBeDisabled();
  release();
  await waitFor(() => expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeEnabled());
});

it("erro ao exportar mostra a mensagem e nao baixa nada", async () => {
  const stub = stubDownload();
  const api = renderPage();
  await screen.findByRole("region", { name: "Relatório em BRL" });
  api.state.csvError = { status: 500, code: "internal_error" };
  await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");
  expect(stub.downloads).toEqual([]);
  expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
});

it("sem sessao no CSV (401) mostra a mensagem de sessao", async () => {
  stubDownload();
  const api = renderPage();
  await screen.findByRole("region", { name: "Relatório em BRL" });
  api.state.csvError = { status: 401, code: "token_missing" };
  await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sua sessão expirou");
});
