import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Account } from "@/api/accounts";
import type { ReportTotals } from "@/api/reports";
import { syncAppClock } from "@/lib/app-clock";
import { formatMoney } from "@/lib/money";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi, makeBudget } from "@/test-utils/budgets-api";
import { fakeDashboardApi, makeNetWorth, makeNetWorthCurrency, makeUpcoming, makeUpcomingItem } from "@/test-utils/dashboard-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { fakePiggyBanksApi, makePiggyBank } from "@/test-utils/piggy-banks-api";
import { fakeReportsApi, makeGroup, makeRow, makeTotals } from "@/test-utils/reports-api";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import { makeTransaction } from "@/test-utils/transaction-fixtures";
import { FakeAuth } from "@/test-utils/providers";
import type { DonutChartProps, LineChartProps, SparklineProps } from "@/components/charts";
import DashboardPage from "./dashboard";

// Os graficos sao provisorios (o trilho B os implementa em paralelo); aqui so se confere o que a
// pagina PASSA pra eles (series, slices, formatValue...), nao o desenho em si
const chartCalls = { donut: [] as DonutChartProps[], line: [] as LineChartProps[], sparkline: [] as SparklineProps[] };

vi.mock("@/components/charts", () => ({
  DonutChart: (props: DonutChartProps) => {
    chartCalls.donut.push(props);
    return <div role="img" aria-label={props.title} data-chart="donut" data-stub className={props.className} />;
  },
  LineChart: (props: LineChartProps) => {
    chartCalls.line.push(props);
    return <div role="img" aria-label={props.title} data-chart="line" data-stub className={props.className} />;
  },
  Sparkline: (props: SparklineProps) => {
    chartCalls.sparkline.push(props);
    return <span role="img" aria-label={props.label} data-chart="sparkline" data-stub className={props.className} />;
  },
}));

// Hoje fixo (meio do mes): bate com o relogio do servidor que a API de relatorios de mentira usa
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 15, 12));
  chartCalls.donut.length = 0;
  chartCalls.line.length = 0;
  chartCalls.sparkline.length = 0;
});
afterEach(() => vi.useRealTimers());

// Registra uma rota de resumo que devolve totais diferentes por periodo, para testar a
// comparacao com o mes passado (a API de relatorios de mentira nao distingue periodo)
function summaryByPeriod(thisMonth: ReportTotals[], lastMonth: ReportTotals[] = []) {
  return http.get("*/api/v1/reports/summary", ({ request }) => {
    const period = new URL(request.url).searchParams.get("period");
    return HttpResponse.json({
      date_from: "2026-03-01",
      date_to: "2026-03-31",
      currencies: period === "last-month" ? lastMonth : thisMonth,
    });
  });
}

type Options = {
  accounts?: Account[];
  summary?: ReturnType<typeof summaryByPeriod>;
  category?: ReturnType<typeof makeGroup>[];
  budgets?: ReturnType<typeof makeBudget>[];
  extraHandlers?: Parameters<typeof server.use>;
};

function renderPage({ accounts = [makeAccount()], summary, category = [], budgets = [], extraHandlers = [] }: Options = {}) {
  const accountsApi = fakeAccountsApi(accounts);
  const dashboardApi = fakeDashboardApi({ netWorth: makeNetWorth(), upcoming: makeUpcoming() });
  const reportsApi = fakeReportsApi({ category });
  const budgetsApi = fakeBudgetsApi(budgets);
  const transactionsApi = fakeTransactionsApi([], accounts);
  const piggyApi = fakePiggyBanksApi([]);
  const categoriesApi = fakeLabelsApi("categories", []);
  const tagsApi = fakeLabelsApi("tags", []);

  server.use(
    ...(summary ? [summary] : []),
    ...accountsApi.handlers,
    ...dashboardApi.handlers,
    ...reportsApi.handlers,
    ...budgetsApi.handlers,
    ...transactionsApi.handlers,
    ...piggyApi.handlers,
    ...categoriesApi.handlers,
    ...tagsApi.handlers,
    ...extraHandlers,
  );

  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return { accountsApi, dashboardApi, reportsApi, budgetsApi, transactionsApi, piggyApi };
}

const region = (name: string) => screen.findByRole("region", { name });

// ---------- Vazio sem contas ----------

it("sem nenhuma conta, mantem o estado vazio e nao pede os dados dos outros blocos", async () => {
  // So registra a rota de contas: se o painel pedir qualquer outra coisa, o msw ("onUnhandledRequest: error") falha o teste
  server.use(...fakeAccountsApi([]).handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  expect(await screen.findByText("Nenhuma conta ainda")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Cadastrar conta" })).toHaveAttribute("href", "/contas");
  expect(screen.queryByRole("heading", { name: "Patrimônio" })).not.toBeInTheDocument();
});

it("se a consulta de contas falha, mostra o erro com Tentar de novo (nao o vazio) e recarrega ao tentar", async () => {
  const user = userEvent.setup();
  let failing = true;
  const accountsApi = fakeAccountsApi([makeAccount()]);
  server.use(
    http.get("*/api/v1/accounts", () => {
      if (failing) return HttpResponse.json({ detail: "falha" }, { status: 500 });
      // Depois do retry, devolve a lista normal da API de mentira
      return undefined;
    }),
    ...accountsApi.handlers,
    ...fakeDashboardApi({ netWorth: makeNetWorth(), upcoming: makeUpcoming() }).handlers,
    ...fakeReportsApi({}).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...fakeTransactionsApi([], [makeAccount()]).handlers,
    ...fakePiggyBanksApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  const retry = await screen.findByRole("button", { name: "Tentar de novo" });
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("Nenhuma conta ainda")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Cadastrar conta" })).not.toBeInTheDocument();

  failing = false;
  await user.click(retry);
  expect(await region("Patrimônio")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeInTheDocument();
});

// ---------- Patrimonio ----------

it("patrimonio com uma moeda so: liquido, ativos e dividas aparecem", async () => {
  const netWorth = makeNetWorth({ currencies: [makeNetWorthCurrency("BRL", ["1000.00", "1200.00"], { debt: "300.00" })] });
  const dashboardApi = fakeDashboardApi({ netWorth, upcoming: makeUpcoming() });
  server.use(
    ...fakeAccountsApi([makeAccount()]).handlers,
    ...dashboardApi.handlers,
    ...fakeReportsApi({}).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...fakeTransactionsApi([], []).handlers,
    ...fakePiggyBanksApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  const section = await region("Patrimônio em BRL");
  expect(within(section).getByText("R$ 1.200,00")).toBeInTheDocument();
  expect(within(section).getByText("R$ 1.500,00")).toBeInTheDocument();
  expect(within(section).getByText("-R$ 300,00")).toBeInTheDocument();
});

it("patrimonio com mais de uma moeda: uma secao por moeda, sem somar", async () => {
  const netWorth = makeNetWorth({
    currencies: [
      makeNetWorthCurrency("BRL", ["1000.00", "1200.00"]),
      makeNetWorthCurrency("USD", ["50.00", "80.00"]),
    ],
  });
  const dashboardApi = fakeDashboardApi({ netWorth, upcoming: makeUpcoming() });
  server.use(
    ...fakeAccountsApi([makeAccount()]).handlers,
    ...dashboardApi.handlers,
    ...fakeReportsApi({}).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...fakeTransactionsApi([], []).handlers,
    ...fakePiggyBanksApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  expect(await region("Patrimônio em BRL")).toBeInTheDocument();
  expect(await region("Patrimônio em USD")).toBeInTheDocument();
});

it("patrimonio: um erro so dele aparece, e os outros blocos continuam mostrando os dados deles", async () => {
  const accounts = [makeAccount()];
  server.use(
    // Primeiro na lista: o msw usa o primeiro handler que casa, entao este sobrepoe o de
    // patrimonio que fakeDashboardApi registra logo abaixo
    http.get("*/api/v1/dashboard/net-worth", () => HttpResponse.json({ detail: "erro", code: "internal_error" }, { status: 500 })),
    ...fakeAccountsApi(accounts).handlers,
    ...fakeDashboardApi({ upcoming: makeUpcoming() }).handlers,
    ...fakeReportsApi({}).handlers,
    ...fakeBudgetsApi([makeBudget({ name: "Mercado" })]).handlers,
    ...fakeTransactionsApi([], accounts).handlers,
    ...fakePiggyBanksApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  const netWorthSection = await region("Patrimônio");
  expect(await within(netWorthSection).findByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  const budgetsSection = await region("Orçamentos");
  expect(await within(budgetsSection).findByText("Mercado")).toBeInTheDocument();
});

// ---------- Este mes ----------

it("este mes: mostra receita, despesa e resultado, e a diferenca com o mes passado", async () => {
  const thisMonth = [makeTotals({ currency_code: "BRL", income: "5000.00", expense: "400.00", net: "4600.00" })];
  const lastMonth = [makeTotals({ currency_code: "BRL", income: "4800.00", expense: "500.00", net: "4300.00" })];
  renderPage({ summary: summaryByPeriod(thisMonth, lastMonth) });

  const table = await screen.findByRole("table", { name: /mês em BRL/ });
  const rows = within(table).getAllByRole("row");
  // Receita subiu (bom), despesa caiu (bom), resultado subiu (bom)
  expect(within(rows[1]).getByText(/R\$ 200,00 a mais/)).toBeInTheDocument();
  expect(within(rows[2]).getByText(/R\$ 100,00 a menos/)).toBeInTheDocument();
  expect(within(rows[3]).getByText(/R\$ 300,00 a mais/)).toBeInTheDocument();
});

it("este mes: despesa zero no mes passado nao divide por zero, so nao mostra percentual", async () => {
  const thisMonth = [makeTotals({ currency_code: "BRL", income: "0.00", expense: "150.00", net: "-150.00" })];
  const lastMonth = [makeTotals({ currency_code: "BRL", income: "0.00", expense: "0.00", net: "0.00" })];
  renderPage({ summary: summaryByPeriod(thisMonth, lastMonth) });

  const table = await screen.findByRole("table", { name: /mês em BRL/ });
  const rows = within(table).getAllByRole("row");
  expect(within(rows[2]).getByText(/Sem base de comparação/)).toBeInTheDocument();
});

it("este mes: resultado negativo que piora mostra diferenca negativa como ruim", async () => {
  const thisMonth = [makeTotals({ currency_code: "BRL", income: "100.00", expense: "300.00", net: "-200.00" })];
  const lastMonth = [makeTotals({ currency_code: "BRL", income: "100.00", expense: "150.00", net: "-50.00" })];
  renderPage({ summary: summaryByPeriod(thisMonth, lastMonth) });

  const table = await screen.findByRole("table", { name: /mês em BRL/ });
  const netRow = within(table).getAllByRole("row")[3];
  expect(within(netRow).getByText(/R\$ 150,00 a menos/)).toHaveClass("text-destructive");
});

it("este mes: sem nenhum lancamento no periodo mostra o estado vazio do bloco", async () => {
  renderPage({ summary: summaryByPeriod([]) });
  const section = await region("Este mês");
  expect(await within(section).findByText(/Nenhuma receita ou despesa neste mês/)).toBeInTheDocument();
});

// ---------- Gastos por categoria ----------

it("categoria: top categorias e o link para relatorios", async () => {
  const category = [
    makeGroup(
      [
        makeRow({ id: "a", name: "Mercado", expense: "300.00" }),
        makeRow({ id: "b", name: "Lazer", expense: "100.00" }),
      ],
      { currency_code: "BRL", expense: "400.00" },
    ),
  ];
  renderPage({ category });
  const section = await region("Gastos por categoria");
  expect(await within(section).findByRole("img", { name: /Gastos por categoria em BRL/ })).toBeInTheDocument();
  expect(within(section).getByRole("link", { name: "Ver relatórios" })).toHaveAttribute("href", "/relatorios");

  // O desenho e provisorio; o que importa e o que a pagina passa pra ele
  const props = chartCalls.donut.at(-1);
  expect(props?.slices).toEqual([
    { key: "a", label: "Mercado", value: "300.00" },
    { key: "b", label: "Lazer", value: "100.00" },
  ]);
  expect(props?.maxSlices).toBe(6);
  expect(props?.otherLabel).toBe("Outras");
  expect(props?.formatValue("300.00")).toBe(formatMoney("300.00", "BRL"));
});

it("categoria: sem nenhuma despesa mostra o estado vazio", async () => {
  renderPage({ category: [makeGroup([], { currency_code: "BRL", expense: "0.00" })] });
  const section = await region("Gastos por categoria");
  expect(await within(section).findByText(/Nenhuma despesa com categoria neste mês/)).toBeInTheDocument();
});

it("categoria: com mais de uma moeda, ha um seletor para trocar", async () => {
  const category = [
    makeGroup([makeRow({ id: "a", name: "Mercado", expense: "300.00" })], { currency_code: "BRL" }),
    makeGroup([makeRow({ id: "b", name: "Trip", expense: "80.00" })], { currency_code: "USD" }),
  ];
  renderPage({ category });
  const section = await region("Gastos por categoria");
  await screen.findByRole("img", { name: /Gastos por categoria em BRL/ });
  const select = within(section).getByRole("combobox", { name: "Moeda" });
  await userEvent.selectOptions(select, "USD");
  expect(within(section).getByRole("img", { name: /Gastos por categoria em USD/ })).toBeInTheDocument();
});

// ---------- Orcamentos ----------

it("orcamentos: mostra so os 4 mais perto do limite, com link para a tela de orcamentos", async () => {
  const budgets = [10, 90, 50, 100, 30, 95].map((percent) => makeBudget({ name: `B${percent}`, percent, spent: "0.00" }));
  renderPage({ budgets });
  const section = await region("Orçamentos");
  await within(section).findByText("B100");
  for (const name of ["B100", "B95", "B90", "B50"]) {
    expect(within(section).getByText(name)).toBeInTheDocument();
  }
  expect(within(section).queryByText("B30")).not.toBeInTheDocument();
  expect(within(section).getByRole("link", { name: "Ver orçamentos" })).toHaveAttribute("href", "/orcamentos");
});

it("orcamentos: sem orcamento ativo mostra o estado vazio", async () => {
  renderPage({ budgets: [] });
  const section = await region("Orçamentos");
  expect(await within(section).findByText(/Nenhum orçamento ativo/)).toBeInTheDocument();
});

// ---------- Proximos vencimentos ----------

it("vencimentos: atrasada aparece com selo de texto, nao so pela cor", async () => {
  const upcoming = makeUpcoming({
    items: [
      makeUpcomingItem({ name: "Aluguel", date: "2026-03-10", overdue: true, direction: "out", amount_min: "1000.00", amount_max: "1000.00" }),
      makeUpcomingItem({ name: "Salário", date: "2026-03-28", overdue: false, direction: "in", amount_min: "3000.00", amount_max: "3000.00" }),
    ],
  });
  server.use(
    ...fakeAccountsApi([makeAccount()]).handlers,
    ...fakeDashboardApi({ upcoming, netWorth: makeNetWorth() }).handlers,
    ...fakeReportsApi({}).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...fakeTransactionsApi([], []).handlers,
    ...fakePiggyBanksApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  const section = await region("Próximos vencimentos");
  expect(await within(section).findByText("Aluguel")).toBeInTheDocument();
  expect(within(section).getByText("Atrasada")).toBeInTheDocument();
  expect(within(section).getByText(/Sai/)).toBeInTheDocument();
  expect(within(section).getByText(/Entra/)).toBeInTheDocument();
  expect(within(section).getByText(/R\$ 1\.000,00/)).toBeInTheDocument();
  // Quem sai usa o icone neutro; quem entra, o icone na cor positiva
  const items = within(section).getAllByRole("listitem");
  expect(items[0].querySelector("svg.text-muted-foreground")).toBeInTheDocument();
  expect(items[1].querySelector("svg.text-positive")).toBeInTheDocument();
  expect(within(section).getByRole("link", { name: "Ver contas a pagar" })).toHaveAttribute("href", "/contas-a-pagar");
});

it("vencimentos: faixa de valor quando minimo e maximo sao diferentes", async () => {
  const upcoming = makeUpcoming({
    items: [makeUpcomingItem({ name: "Luz", amount_min: "80.00", amount_max: "140.00", direction: "out", overdue: false })],
  });
  server.use(
    ...fakeAccountsApi([makeAccount()]).handlers,
    ...fakeDashboardApi({ upcoming, netWorth: makeNetWorth() }).handlers,
    ...fakeReportsApi({}).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...fakeTransactionsApi([], []).handlers,
    ...fakePiggyBanksApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  const section = await region("Próximos vencimentos");
  expect(await within(section).findByText(/R\$ 80,00 a R\$ 140,00/)).toBeInTheDocument();
});

it("vencimentos: sem nada nos proximos dias mostra o estado vazio", async () => {
  renderPage();
  const section = await region("Próximos vencimentos");
  await waitFor(() => expect(within(section).getByText(/Nada vencendo/)).toBeInTheDocument());
});

// ---------- Ultimas transacoes ----------

it("transacoes: mostra ate 8 das mais recentes e o link para ver todas", async () => {
  const accounts = [makeAccount({ name: "Nubank" })];
  const transactions = Array.from({ length: 10 }, (_, index) =>
    makeTransaction({ created_at: `2026-03-${String(10 + index).padStart(2, "0")}T12:00:00Z` }, [
      { description: `Compra ${index}`, date: `2026-03-${String(10 + index).padStart(2, "0")}`, source_account_name: "Nubank" },
    ]),
  );
  server.use(
    ...fakeAccountsApi(accounts).handlers,
    ...fakeDashboardApi({ netWorth: makeNetWorth(), upcoming: makeUpcoming() }).handlers,
    ...fakeReportsApi({}).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...fakeTransactionsApi(transactions, accounts).handlers,
    ...fakePiggyBanksApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  const section = await region("Últimas transações");
  await within(section).findByText("Compra 9");
  expect(within(section).getAllByRole("listitem")).toHaveLength(8);
  expect(within(section).getByRole("link", { name: "Ver todas" })).toHaveAttribute("href", "/transacoes");
});

it("transacoes: sem lancamento nenhum mostra o estado vazio", async () => {
  renderPage();
  const section = await region("Últimas transações");
  await waitFor(() => expect(within(section).getByText(/Nenhum lançamento/)).toBeInTheDocument());
});

// ---------- Cofrinhos ----------

it("cofrinhos: mostra quanto ja foi guardado em cada um", async () => {
  server.use(
    ...fakeAccountsApi([makeAccount()]).handlers,
    ...fakeDashboardApi({ netWorth: makeNetWorth(), upcoming: makeUpcoming() }).handlers,
    ...fakeReportsApi({}).handlers,
    ...fakeBudgetsApi([]).handlers,
    ...fakeTransactionsApi([], []).handlers,
    ...fakePiggyBanksApi([makePiggyBank({ name: "Viagem", saved: "300.00", target_amount: "1000.00" })]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  const section = await region("Cofrinhos");
  expect(await within(section).findByText("Viagem")).toBeInTheDocument();
  expect(within(section).getByText("R$ 300,00")).toBeInTheDocument();
});

// ---------- Alertas ----------

it("alertas: contas atrasadas e orcamentos perto ou no limite aparecem no topo, com links", async () => {
  const upcoming = makeUpcoming({ items: [makeUpcomingItem({ overdue: true })] });
  const budgets = [makeBudget({ percent: 100 }), makeBudget({ percent: 85 })];
  server.use(
    ...fakeAccountsApi([makeAccount()]).handlers,
    ...fakeDashboardApi({ upcoming, netWorth: makeNetWorth() }).handlers,
    ...fakeReportsApi({}).handlers,
    ...fakeBudgetsApi(budgets).handlers,
    ...fakeTransactionsApi([], []).handlers,
    ...fakePiggyBanksApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  const alerts = await screen.findByLabelText("Alertas");
  expect(within(alerts).getByText("1 conta atrasada")).toBeInTheDocument();
  expect(within(alerts).getByText("1 orçamento no limite")).toBeInTheDocument();
  expect(within(alerts).getByText(/1 orçamento perto do limite/)).toBeInTheDocument();
  expect(within(alerts).getAllByRole("link", { name: /conta atrasada/ })[0]).toHaveAttribute("href", "/contas-a-pagar");
});

it("alertas: sem nada para avisar, a faixa some por completo", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Patrimônio" });
  expect(screen.queryByLabelText("Alertas")).not.toBeInTheDocument();
  // Nao so o rotulo: nenhum pedaco de aviso (o selo colorido que a faixa usa) fica na pagina
  expect(document.querySelector(".rounded-md.border.px-3.py-2")).not.toBeInTheDocument();
});

it("enquanto um bloco carrega, nao mostra ao mesmo tempo o esqueleto e o estado vazio", async () => {
  renderPage({ summary: summaryByPeriod([]) });
  const section = await region("Este mês");
  // Logo apos o render, antes do pedido simulado responder, so o esqueleto aparece
  expect(within(section).getByRole("status")).toBeInTheDocument();
  expect(within(section).queryByText(/Nenhuma receita/)).not.toBeInTheDocument();
  await within(section).findByText(/Nenhuma receita/);
});

// ---------- Integracao dos trilhos: o que a pagina passa aos graficos e a acessibilidade ----------

function renderWithDashboard(
  dashboard: Parameters<typeof fakeDashboardApi>[0],
  { budgets = [], first = [] }: { budgets?: ReturnType<typeof makeBudget>[]; first?: Parameters<typeof server.use> } = {},
) {
  server.use(
    ...first,
    ...fakeAccountsApi([makeAccount()]).handlers,
    ...fakeDashboardApi(dashboard).handlers,
    ...fakeReportsApi({}).handlers,
    ...fakeBudgetsApi(budgets).handlers,
    ...fakeTransactionsApi([], []).handlers,
    ...fakePiggyBanksApi([]).handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeLabelsApi("tags", []).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </FakeAuth>,
  );
}

it("o grafico de patrimonio pede a area sob a linha e nao repete um minigrafico", async () => {
  renderWithDashboard({
    netWorth: makeNetWorth({ currencies: [makeNetWorthCurrency("BRL", ["1000.00", "1200.00", "900.50"])] }),
    upcoming: makeUpcoming(),
  });
  await region("Patrimônio em BRL");
  const line = chartCalls.line.at(-1)!;
  expect(line.area).toBe(true);
  expect(line.series[0].points.map((point) => point.value)).toEqual(["1000.00", "1200.00", "900.50"]);
  // O grafico de linha ja mostra a serie: o painel nao repete um minigrafico solto sobre ele
  expect(chartCalls.sparkline).toHaveLength(0);
});

it("a faixa de alertas e uma regiao nomeada para leitor de tela", async () => {
  renderWithDashboard({ upcoming: makeUpcoming({ items: [makeUpcomingItem({ overdue: true })] }), netWorth: makeNetWorth() });
  const alerts = await screen.findByRole("region", { name: "Alertas" });
  expect(within(alerts).getByText("1 conta atrasada")).toBeInTheDocument();
});

it("este mes: a diferenca respeita as casas decimais da moeda (3 casas nao sao truncadas em 2)", async () => {
  const thisMonth = [makeTotals({ currency_code: "KWD", income: "10.505", expense: "0.000", net: "10.505" })];
  const lastMonth = [makeTotals({ currency_code: "KWD", income: "10.500", expense: "0.000", net: "10.500" })];
  const kuwait = http.get("*/api/v1/currencies", () =>
    HttpResponse.json([{ code: "KWD", name: "Dinar kuwaitiano", symbol: "KWD", decimal_places: 3 }]),
  );
  renderWithDashboard({ netWorth: makeNetWorth(), upcoming: makeUpcoming() }, { first: [kuwait, summaryByPeriod(thisMonth, lastMonth)] });
  const table = await screen.findByRole("table", { name: /mês em KWD/ });
  const rows = within(table).getAllByRole("row");
  expect(within(rows[1]).getByText(/0,005 a mais/)).toBeInTheDocument();
});

it("este mes: moeda sem casas decimais (JPY) compara em unidades inteiras", async () => {
  const thisMonth = [makeTotals({ currency_code: "JPY", income: "1500", expense: "200", net: "1300" })];
  const lastMonth = [makeTotals({ currency_code: "JPY", income: "1200", expense: "250", net: "950" })];
  renderWithDashboard({ netWorth: makeNetWorth(), upcoming: makeUpcoming() }, { first: [summaryByPeriod(thisMonth, lastMonth)] });
  const table = await screen.findByRole("table", { name: /mês em JPY/ });
  const rows = within(table).getAllByRole("row");
  expect(within(rows[1]).getByText(/300 a mais/)).toBeInTheDocument();
  expect(within(rows[2]).getByText(/50 a menos/)).toBeInTheDocument();
});

// ---------- Ultimas transacoes: linhas compactas ----------

// O Testing Library troca o espaco sem quebra do Intl por espaco comum; o texto esperado precisa fazer o mesmo
const money = (value: string) => formatMoney(value, "BRL").replace(/\s/g, " ");

function renderWithTransactions(transactions: ReturnType<typeof makeTransaction>[], categories = [makeLabel({ name: "Mercado" })]) {
  const accounts = [makeAccount({ name: "Nubank" })];
  renderWithDashboard(
    { netWorth: makeNetWorth(), upcoming: makeUpcoming() },
    { first: [...fakeTransactionsApi(transactions, accounts).handlers, ...fakeLabelsApi("categories", categories).handlers] },
  );
}

it("transacoes: cada lancamento e uma linha so, com data, titulo, categoria e valor", async () => {
  const mercado = makeLabel({ name: "Mercado" });
  renderWithTransactions(
    [makeTransaction({}, [{ description: "Compra do mes", date: "2026-03-14", amount: "132.40", category_id: mercado.id }])],
    [mercado],
  );
  const section = await region("Últimas transações");
  const row = (await within(section).findByText("Compra do mes")).closest("li") as HTMLElement;
  expect(within(row).getByText("Ontem")).toBeInTheDocument();
  expect(within(row).getByText(/Mercado/)).toBeInTheDocument();
  expect(within(row).getByText(money("-132.40"))).toBeInTheDocument();
  // Sem cartao: nao ha menu de acoes dentro do bloco
  expect(within(section).queryByRole("button")).not.toBeInTheDocument();
});

it("transacoes: entrada em verde, saida na cor normal", async () => {
  renderWithTransactions([
    makeTransaction({}, [{ type: "deposit", description: "Salario do mes", date: "2026-03-15", amount: "7200.00" }]),
    makeTransaction({}, [{ description: "Padaria", date: "2026-03-15", amount: "12.00" }]),
  ]);
  const section = await region("Últimas transações");
  const income = await within(section).findByText("+" + money("7200.00"));
  expect(income).toHaveClass("text-positive");
  expect(within(section).getByText(money("-12.00"))).not.toHaveClass("text-positive");
});

it("transacoes: titulo longo e cortado com reticencias e guarda o texto inteiro no title", async () => {
  const long = "Compra muito longa no supermercado do bairro com varias coisas que nao cabem na linha do painel";
  renderWithTransactions([makeTransaction({}, [{ description: long, date: "2026-03-15" }])]);
  const section = await region("Últimas transações");
  const title = await within(section).findByText(long);
  const paragraph = title.closest("p") as HTMLElement;
  expect(paragraph).toHaveClass("truncate");
  expect(paragraph).toHaveAttribute("title", long);
});

it("transacoes: o title da linha traz titulo e categoria, para ler o que o corte esconde", async () => {
  const mercado = makeLabel({ name: "Mercado" });
  renderWithTransactions([makeTransaction({}, [{ description: "Compra do mes", date: "2026-03-15", category_id: mercado.id }])], [mercado]);
  const section = await region("Últimas transações");
  const title = await within(section).findByText("Compra do mes");
  expect(title.closest("p")).toHaveAttribute("title", "Compra do mes · Mercado");
});

it("transacoes: dividido com categoria no primeiro split mostra so as partes, nao a categoria", async () => {
  const mercado = makeLabel({ name: "Mercado" });
  renderWithTransactions(
    [makeTransaction({ title: "Compras" }, [
      { description: "A", date: "2026-03-15", amount: "10.00", category_id: mercado.id },
      { description: "B", date: "2026-03-15", amount: "10.00" },
    ])],
    [mercado],
  );
  const section = await region("Últimas transações");
  const row = (await within(section).findByText("Compras")).closest("li") as HTMLElement;
  expect(within(row).getByText(/Dividida em 2/)).toBeInTheDocument();
  expect(within(row).queryByText(/Mercado/)).not.toBeInTheDocument();
});

it("transacoes: lancamento dividido diz em quantas partes e soma o valor", async () => {
  renderWithTransactions([
    makeTransaction({ title: "Churrasco" }, [
      { description: "Carne", date: "2026-03-15", amount: "30.00" },
      { description: "Bebida", date: "2026-03-15", amount: "20.00" },
    ]),
  ]);
  const section = await region("Últimas transações");
  const row = (await within(section).findByText("Churrasco")).closest("li") as HTMLElement;
  expect(within(row).getByText(/Dividida em 2/)).toBeInTheDocument();
  expect(within(row).getByText(money("-50.00"))).toBeInTheDocument();
});

it("transacoes: o dia vem do relogio do app (aparelho atrasado ainda mostra Hoje e Ontem certos)", async () => {
  vi.setSystemTime(new Date("2020-01-15T12:00:00Z"));
  syncAppClock({ now: "2026-03-15T15:00:00Z", timezone: "America/Sao_Paulo" });
  renderWithTransactions([
    makeTransaction({}, [{ description: "De hoje", date: "2026-03-15" }]),
    makeTransaction({}, [{ description: "De ontem", date: "2026-03-14" }]),
  ]);
  const section = await region("Últimas transações");
  const today = (await within(section).findByText("De hoje")).closest("li") as HTMLElement;
  const yesterday = within(section).getByText("De ontem").closest("li") as HTMLElement;
  expect(within(today).getByText("Hoje")).toBeInTheDocument();
  expect(within(yesterday).getByText("Ontem")).toBeInTheDocument();
});

// ---------- Layout no desktop: sem buracos nem faixas vazias ----------

it("os blocos ficam numa grade que se encaixa pela altura real, de 1 a 2 colunas conforme a tela", async () => {
  renderPage();
  const columns = await screen.findByTestId("dashboard-columns");
  expect(columns).toHaveClass("grid-cols-1", "lg:grid-cols-2");
  // Grade com "dense": cada bloco ocupa quantas linhas precisar, sem buraco ao lado do bloco curto
  // nem sobra no fim de uma coluna mais curta (ver MasonryColumns)
  expect(columns.className).toContain("grid");
  expect(columns.className).toContain("[grid-auto-flow:dense]");
});

it("o patrimonio fica fora das colunas, ocupando a largura toda", async () => {
  renderPage();
  const columns = await screen.findByTestId("dashboard-columns");
  const networth = await screen.findByRole("region", { name: "Patrimônio" });
  expect(columns.contains(networth)).toBe(false);
  expect(networth.className).not.toContain("col-span");
});

it("as colunas trazem os outros blocos, na ordem de leitura", async () => {
  renderPage();
  const columns = await screen.findByTestId("dashboard-columns");
  await within(columns).findByRole("region", { name: "Este mês" });
  const names = [...columns.children].map((child) => child.getAttribute("aria-label") ?? child.querySelector("h2")?.textContent);
  expect(names.slice(0, 2)).toEqual(["Este mês", "Gastos por categoria"]);
});

it("com mais de uma moeda, os graficos do patrimonio ficam lado a lado no desktop", async () => {
  renderWithDashboard({
    netWorth: makeNetWorth({
      currencies: [
        makeNetWorthCurrency("BRL", ["100.00", "200.00"]),
        makeNetWorthCurrency("USD", ["10.00", "20.00"]),
      ],
    }),
  });
  const grid = await screen.findByTestId("net-worth-currencies");
  expect(grid).toHaveClass("grid", "lg:grid-cols-2");
});

it("com uma moeda so, o patrimonio continua em uma coluna", async () => {
  renderPage();
  const list = await screen.findByTestId("net-worth-currencies");
  expect(list).toHaveClass("flex", "flex-col");
  expect(list).not.toHaveClass("lg:grid-cols-2");
});
