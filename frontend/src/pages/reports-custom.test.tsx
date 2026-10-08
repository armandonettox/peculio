import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SavedReport } from "@/api/saved-reports";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi, makeBudget } from "@/test-utils/budgets-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { LocationProbe } from "@/test-utils/location-probe";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeReportsApi, makeGroup, makeMonthly, makeRow, makeTotals, type ReportData } from "@/test-utils/reports-api";
import { fakeSavedReportsApi, makeSaved } from "@/test-utils/saved-reports-api";
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

const user = userEvent.setup();

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => makeRow({ name: `Grupo ${index + 1}`, expense: `${(count - index) * 10}.00` }));

function baseData(): Partial<ReportData> {
  return {
    summary: [makeTotals()],
    category: [
      makeGroup([
        makeRow({ name: "Mercado", expense: "500.50", net: "-500.50", count: 2 }),
        makeRow({ id: null, name: "Sem categoria", expense: "45.90", net: "-45.90" }),
        makeRow({ name: "Salario", income: "5000.00", net: "5000.00" }),
      ]),
    ],
    monthly: [
      makeMonthly("BRL", [
        { month: "2026-01", income: "5000.00", expense: "280.50", net: "4719.50", count: 3 },
        { month: "2026-02", income: "0.00", expense: "0.00", net: "0.00", count: 0 },
        { month: "2026-03", income: "0.00", expense: "405.90", net: "-405.90", count: 2 },
      ]),
    ],
    counterparty: [makeGroup([makeRow({ name: "Padaria", expense: "20.00" }), makeRow({ name: "Empresa", income: "1000.00" })])],
    tag: [makeGroup([makeRow({ name: "viagem", expense: "300.00" })])],
  };
}

type Setup = { data?: Partial<ReportData>; saved?: SavedReport[]; path?: string };

function renderPage({ data = baseData(), saved = [], path = "/relatorios?aba=personalizado" }: Setup = {}) {
  const reports = fakeReportsApi(data);
  const savedApi = fakeSavedReportsApi(saved);
  server.use(
    ...reports.handlers,
    ...savedApi.handlers,
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
  return { reports, savedApi };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLSelectElement | HTMLInputElement;
const optionsOf = (label: string) => [...(field(label) as HTMLSelectElement).options].map((option) => option.text);
const lastQuery = (reports: ReturnType<typeof fakeReportsApi>, route: string) => {
  const all = reports.requestsTo(route);
  return all[all.length - 1].query;
};
const dialog = () => screen.getByRole("dialog");
const location = () => screen.getByTestId("location").textContent;

// ---------- Abas ----------

it("abre no resumo de sempre; Personalizado troca de aba e lembra na URL", async () => {
  const { reports } = renderPage({ path: "/relatorios" });
  await screen.findByRole("region", { name: "Relatório em BRL" });
  expect(screen.queryByRole("region", { name: "Montar relatório" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Personalizado" }));
  expect(await screen.findByRole("region", { name: "Montar relatório" })).toBeInTheDocument();
  expect(location()).toContain("aba=personalizado");
  expect(screen.queryByRole("button", { name: "Exportar CSV" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Personalizado" })).toHaveAttribute("aria-selected", "true");
  void reports;

  await user.click(screen.getByRole("tab", { name: "Resumo" }));
  expect(await screen.findByRole("region", { name: "Relatório em BRL" })).toBeInTheDocument();
  expect(location()).not.toContain("aba=");
});

it("na aba Personalizado os pedidos do resumo nao rodam", async () => {
  const { reports } = renderPage();
  await screen.findByRole("region", { name: "Montar relatório" });
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  expect(reports.requestsTo("summary")).toHaveLength(0);
  expect(reports.requestsTo("by-tag")).toHaveLength(0);
});

// ---------- O relatorio ----------

it("comeca com despesas por categoria em rosca no mes atual", async () => {
  const { reports } = renderPage();
  const report = await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  expect(field("Agrupar por")).toHaveValue("category");
  expect(field("Medir")).toHaveValue("expense");
  expect(field("Gráfico")).toHaveValue("donut");
  expect(field("Período")).toHaveValue("this-month");
  expect(lastQuery(reports, "by-category").get("period")).toBe("this-month");
  expect(report.querySelector('[data-chart="donut"]')).not.toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: /Despesas por categoria/ })).toBeInTheDocument();
});

it("a tabela completa mostra todos os grupos com o texto de sem categoria", async () => {
  renderPage();
  const report = await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  const table = within(report).getByRole("table", { name: /todos os grupos/ });
  expect(within(table).getByRole("rowheader", { name: "Mercado" })).toBeInTheDocument();
  expect(within(table).getByRole("rowheader", { name: "Sem categoria" })).toBeInTheDocument();
  expect(within(table).getByRole("rowheader", { name: "Salario" })).toBeInTheDocument();
  expect(within(table).getAllByRole("rowheader")).toHaveLength(3);
});

it("mostra o periodo que o servidor resolveu", async () => {
  renderPage();
  expect(await screen.findByText(/Período: 01\/03\/2026 a 31\/03\/2026/)).toBeInTheDocument();
});

it("agrupar por mes troca a rosca por linha e pede o grafico mensal", async () => {
  const { reports } = renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Agrupar por"), "month");
  expect(field("Gráfico")).toHaveValue("line");
  const report = await screen.findByRole("region", { name: "Despesas mês a mês em BRL" });
  expect(report.querySelector('[data-chart="line"]')).not.toBeNull();
  expect(reports.requestsTo("monthly").length).toBeGreaterThan(0);
  const table = within(report).getByRole("table", { name: /todos os grupos/ });
  expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
    "janeiro de 2026",
    "fevereiro de 2026",
    "março de 2026",
  ]);
});

it("de volta a categoria, a linha vira barras", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Agrupar por"), "month");
  await screen.findByRole("region", { name: "Despesas mês a mês em BRL" });
  await user.selectOptions(field("Agrupar por"), "category");
  expect(field("Gráfico")).toHaveValue("bar");
});

it("so oferece os graficos que servem e troca a rosca quando a medida vira saldo", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  expect(optionsOf("Gráfico")).toEqual(["Tabela", "Barras", "Rosca"]);
  await user.selectOptions(field("Medir"), "net");
  expect(optionsOf("Gráfico")).toEqual(["Tabela", "Barras"]);
  expect(field("Gráfico")).toHaveValue("bar");
  await user.selectOptions(field("Agrupar por"), "month");
  expect(optionsOf("Gráfico")).toEqual(["Tabela", "Barras", "Linha"]);
});

it("barras: a medida escolhida decide a lista e o titulo", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Gráfico"), "bar");
  await user.selectOptions(field("Medir"), "income");
  const bars = await screen.findByRole("list", { name: "Receitas por categoria em BRL" });
  expect(within(bars).getAllByRole("listitem")).toHaveLength(1);
  expect(within(bars).getByText("Salario")).toBeInTheDocument();
});

it("so a tabela: nenhum grafico", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Gráfico"), "table");
  const report = screen.getByRole("region", { name: "Despesas por categoria em BRL" });
  expect(report.querySelector("[data-chart]")).toBeNull();
  expect(within(report).queryByRole("list")).not.toBeInTheDocument();
  expect(within(report).getByRole("table")).toBeInTheDocument();
});

it("com mais de 11 grupos, as barras mostram os 10 maiores e Outros; a tabela tem todos", async () => {
  renderPage({ data: { ...baseData(), category: [makeGroup(rows(14))] } });
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Gráfico"), "bar");
  const bars = await screen.findByRole("list", { name: "Despesas por categoria em BRL" });
  const items = within(bars).getAllByRole("listitem");
  expect(items).toHaveLength(11);
  expect(items[0]).toHaveTextContent("Grupo 1");
  expect(items[10]).toHaveTextContent("Outros");
  // 4 grupos no resto: 40 + 30 + 20 + 10
  expect(items[10].textContent?.replace(/\s/g, " ")).toContain("R$ 100,00");
  expect(screen.getByText(/O gráfico mostra os 10 maiores/)).toBeInTheDocument();
  expect(within(screen.getByRole("table", { name: /todos os grupos/ })).getAllByRole("rowheader")).toHaveLength(14);
});

it("a rosca tambem junta o resto em Outros depois dos 10 maiores", async () => {
  renderPage({ data: { ...baseData(), category: [makeGroup(rows(14))] } });
  const report = await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  const legend = [...report.querySelectorAll("[data-legend]")];
  expect(legend).toHaveLength(11);
  expect(legend[10].textContent).toContain("Outros");
  expect(legend[10].getAttribute("data-legend")).toBe("__other__");
});

it("a rosca com 11 grupos mostra todos pelo nome", async () => {
  renderPage({ data: { ...baseData(), category: [makeGroup(rows(11))] } });
  const report = await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  expect(report.querySelectorAll("[data-legend]")).toHaveLength(11);
  expect(report.querySelector('[data-legend="__other__"]')).toBeNull();
});

it("quando nenhum grupo tem a medida, diz isso em vez de desenhar um grafico vazio", async () => {
  renderPage({ data: { ...baseData(), category: [makeGroup([makeRow({ name: "Mercado", expense: "50.00" })])] } });
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Gráfico"), "bar");
  await user.selectOptions(field("Medir"), "income");
  expect(await screen.findByText("Nenhum grupo tem receitas neste período.")).toBeInTheDocument();
  const report = screen.getByRole("region", { name: "Receitas por categoria em BRL" });
  expect(within(report).queryByRole("list")).not.toBeInTheDocument();
  // A tabela continua com todos os grupos
  expect(within(report).getByRole("rowheader", { name: "Mercado" })).toBeInTheDocument();
});

it("a tabela traz a quantidade de lancamentos de cada grupo", async () => {
  renderPage();
  const report = await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  const table = within(report).getByRole("table", { name: /todos os grupos/ });
  expect(within(table).getByRole("columnheader", { name: "Lançamentos" })).toBeInTheDocument();
  const row = within(table).getByRole("rowheader", { name: "Mercado" }).closest("tr") as HTMLElement;
  expect(within(row).getAllByRole("cell").at(-1)).toHaveTextContent("2");
});

it("com 11 grupos, mostra todos pelo nome e nao fala em Outros", async () => {
  renderPage({ data: { ...baseData(), category: [makeGroup(rows(11))] } });
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Gráfico"), "bar");
  const bars = await screen.findByRole("list", { name: "Despesas por categoria em BRL" });
  expect(within(bars).getAllByRole("listitem")).toHaveLength(11);
  expect(within(bars).queryByText("Outros")).not.toBeInTheDocument();
  expect(screen.queryByText(/O gráfico mostra os 10 maiores/)).not.toBeInTheDocument();
});

it("grupos sem a medida escolhida nao viram barra", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Gráfico"), "bar");
  const bars = await screen.findByRole("list", { name: "Despesas por categoria em BRL" });
  expect(within(bars).queryByText("Salario")).not.toBeInTheDocument();
  expect(within(bars).getAllByRole("listitem")).toHaveLength(2);
});

it("moedas diferentes ficam em secoes separadas", async () => {
  const usd = makeGroup([makeRow({ name: "Lazer", expense: "30.00" })], { currency_code: "USD" });
  renderPage({ data: { ...baseData(), category: [...baseData().category!, usd] } });
  expect(await screen.findByRole("region", { name: "Despesas por categoria em BRL" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Despesas por categoria em USD" })).toBeInTheDocument();
});

it("agrupar por contraparte usa a rota nova; por tag mostra o aviso das varias tags", async () => {
  const { reports } = renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Agrupar por"), "counterparty");
  await screen.findByRole("region", { name: "Despesas por contraparte em BRL" });
  expect(reports.requestsTo("by-counterparty").length).toBeGreaterThan(0);
  await user.selectOptions(field("Agrupar por"), "tag");
  await screen.findByRole("region", { name: "Despesas por tag em BRL" });
  expect(screen.getByText(/aparece em cada uma delas/)).toBeInTheDocument();
});

it("sem nada no periodo, mostra o estado vazio", async () => {
  renderPage({ data: { ...baseData(), category: [] } });
  expect(await screen.findByText("Nada neste período")).toBeInTheDocument();
});

it("erro do servidor mostra o aviso e tenta de novo", async () => {
  const { reports } = renderPage();
  reports.state.errors = [{ status: 500, code: "internal_error" }];
  await screen.findByRole("region", { name: "Montar relatório" });
  const retry = await screen.findByRole("button", { name: "Tentar de novo" });
  await user.click(retry);
  expect(await screen.findByRole("region", { name: "Despesas por categoria em BRL" })).toBeInTheDocument();
});

// ---------- Periodo e filtros ----------

it("periodos novos vao como period", async () => {
  const { reports } = renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Período"), "last-3-months");
  await waitFor(() => expect(lastQuery(reports, "by-category").get("period")).toBe("last-3-months"));
  await user.selectOptions(field("Período"), "last-12-months");
  await waitFor(() => expect(lastQuery(reports, "by-category").get("period")).toBe("last-12-months"));
});

it("datas fixas pedem as duas datas e so entao fazem o pedido, sem period", async () => {
  const { reports } = renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  const before = reports.requestsTo("by-category").length;
  await user.selectOptions(field("Período"), "fixed");
  expect(await screen.findByText("Informe as duas datas.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Salvar relatório" })).toBeDisabled();
  expect(reports.requestsTo("by-category")).toHaveLength(before);

  await user.type(field("Data inicial"), "2026-01-01");
  await user.type(field("Data final"), "2026-02-28");
  await waitFor(() => expect(reports.requestsTo("by-category").length).toBeGreaterThan(before));
  const query = lastQuery(reports, "by-category");
  expect([query.get("date_from"), query.get("date_to"), query.get("period")]).toEqual(["2026-01-01", "2026-02-28", null]);
  expect(screen.getByRole("button", { name: "Salvar relatório" })).toBeEnabled();
});

it("datas ao contrario mostram o erro", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Período"), "fixed");
  await user.type(field("Data inicial"), "2026-03-01");
  await user.type(field("Data final"), "2026-01-01");
  expect(await screen.findByText("A data inicial é depois da data final.")).toBeVisible();
});

it("os filtros vao na consulta", async () => {
  const { reports } = renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Categoria"), "Mercado");
  await user.selectOptions(field("Conta"), "Nubank");
  await user.selectOptions(field("Tag"), "viagem");
  await user.selectOptions(field("Orçamento"), "Casa");
  await waitFor(() => {
    const query = lastQuery(reports, "by-category");
    expect([query.get("category_id"), query.get("account_id"), query.get("tag_id"), query.get("budget_id")]).toEqual([
      mercado.id,
      nubank.id,
      viagem.id,
      casa.id,
    ]);
  });
});

// ---------- Relatorios salvos ----------

it("sem relatorios salvos, explica como salvar", async () => {
  renderPage();
  expect(await screen.findByText(/Você ainda não salvou nenhum relatório/)).toBeInTheDocument();
});

it("a lista mostra o resumo de cada relatorio, em ordem de nome", async () => {
  renderPage({
    saved: [
      makeSaved({ name: "Viagens", group_by: "tag", chart: "bar", measure: "income", period: "last-12-months" }),
      makeSaved({ name: "Casa", group_by: "month", chart: "line", measure: "net", period: "fixed", date_from: "2026-01-01", date_to: "2026-02-01" }),
    ],
  });
  const panel = await screen.findByRole("region", { name: "Relatórios salvos" });
  const items = await within(panel).findAllByRole("listitem");
  expect(items[0]).toHaveTextContent("Casa");
  expect(items[0]).toHaveTextContent("Saldo por mês · Linha · Datas fixas");
  expect(items[1]).toHaveTextContent("Viagens");
  expect(items[1]).toHaveTextContent("Receitas por tag · Barras · Últimos 12 meses");
});

it("abrir um relatorio salvo monta o relatorio e marca como aberto", async () => {
  const { reports } = renderPage({
    saved: [makeSaved({ name: "Viagens", group_by: "tag", chart: "bar", measure: "expense", period: "last-3-months", tag_id: viagem.id })],
  });
  await user.click(await screen.findByRole("button", { name: "Abrir Viagens" }));
  expect(field("Agrupar por")).toHaveValue("tag");
  expect(field("Gráfico")).toHaveValue("bar");
  expect(field("Período")).toHaveValue("last-3-months");
  await waitFor(() => expect(field("Tag")).toHaveValue(viagem.id));
  expect(screen.getByText(/Aberto:/)).toHaveTextContent("Aberto: Viagens");
  expect(screen.getByText(/Aberto:/)).not.toHaveTextContent("mudanças");
  await waitFor(() => expect(lastQuery(reports, "by-tag").get("period")).toBe("last-3-months"));
  expect(lastQuery(reports, "by-tag").get("tag_id")).toBe(viagem.id);
});

it("mudar algo num relatorio aberto avisa que ha mudancas nao salvas", async () => {
  renderPage({ saved: [makeSaved({ name: "Mensal" })] });
  await user.click(await screen.findByRole("button", { name: "Abrir Mensal" }));
  await user.selectOptions(field("Medir"), "income");
  expect(await screen.findByText(/com mudanças ainda não salvas/)).toBeInTheDocument();
  await user.selectOptions(field("Medir"), "expense");
  await waitFor(() => expect(screen.queryByText(/com mudanças ainda não salvas/)).not.toBeInTheDocument());
});

it("salvar um relatorio novo pede o nome e manda a configuracao", async () => {
  const { savedApi } = renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Agrupar por"), "month");
  await user.selectOptions(field("Medir"), "net");
  await user.selectOptions(field("Período"), "last-12-months");
  await user.click(screen.getByRole("button", { name: "Salvar relatório" }));

  await user.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  expect(await within(dialog()).findByText("Informe o nome do relatório.")).toBeVisible();
  expect(savedApi.writes()).toHaveLength(0);

  await user.type(within(dialog()).getByLabelText("Nome"), "  Evolucao  ");
  await user.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(savedApi.writes()).toHaveLength(1));
  expect(savedApi.writes()[0]).toMatchObject({
    method: "POST",
    body: {
      name: "Evolucao",
      group_by: "month",
      chart: "line",
      measure: "net",
      period: "last-12-months",
      account_id: null,
      category_id: null,
      tag_id: null,
      budget_id: null,
    },
  });
  expect(savedApi.writes()[0].body).not.toHaveProperty("date_from");
  expect(await screen.findByText("Relatório salvo.")).toBeVisible();
  expect(await screen.findByText(/Aberto:/)).toHaveTextContent("Aberto: Evolucao");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const panel = screen.getByRole("region", { name: "Relatórios salvos" });
  expect(await within(panel).findByRole("button", { name: "Abrir Evolucao" })).toBeInTheDocument();
});

it("datas fixas e filtros vao junto ao salvar", async () => {
  const { savedApi } = renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.selectOptions(field("Período"), "fixed");
  await user.type(field("Data inicial"), "2026-01-01");
  await user.type(field("Data final"), "2026-02-28");
  await user.selectOptions(field("Categoria"), "Mercado");
  await user.click(screen.getByRole("button", { name: "Salvar relatório" }));
  await user.type(within(dialog()).getByLabelText("Nome"), "Fixo");
  await user.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(savedApi.writes()).toHaveLength(1));
  expect(savedApi.writes()[0].body).toMatchObject({
    period: "fixed",
    date_from: "2026-01-01",
    date_to: "2026-02-28",
    category_id: mercado.id,
  });
});

it("nome com mais de 80 letras e recusado antes de ir ao servidor", async () => {
  const { savedApi } = renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  await user.click(screen.getByRole("button", { name: "Salvar relatório" }));
  await user.type(within(dialog()).getByLabelText("Nome"), "x".repeat(81));
  await user.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  expect(await within(dialog()).findByText("Use no máximo 80 letras.")).toBeVisible();
  expect(savedApi.writes()).toHaveLength(0);
  await user.type(within(dialog()).getByLabelText("Nome"), "{Backspace}");
  await user.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(savedApi.writes()).toHaveLength(1));
});

it("o relatorio aberto fica destacado na lista", async () => {
  renderPage({ saved: [makeSaved({ name: "Mensal" }), makeSaved({ name: "Outro" })] });
  await user.click(await screen.findByRole("button", { name: "Abrir Mensal" }));
  expect(screen.getByRole("button", { name: "Abrir Mensal" })).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("button", { name: "Abrir Outro" })).not.toHaveAttribute("aria-current");
});

it("nome repetido aparece no campo e o dialogo continua aberto", async () => {
  const { savedApi } = renderPage({ saved: [makeSaved({ name: "Mensal" })] });
  await screen.findByRole("button", { name: "Abrir Mensal" });
  await user.click(screen.getByRole("button", { name: "Salvar relatório" }));
  await user.type(within(dialog()).getByLabelText("Nome"), "mensal");
  await user.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  expect(await within(dialog()).findByText("Já existe um relatório salvo com esse nome.")).toBeVisible();
  expect(savedApi.state.reports).toHaveLength(1);
  // Corrigir o nome limpa o erro
  await user.type(within(dialog()).getByLabelText("Nome"), "2");
  expect(within(dialog()).queryByText("Já existe um relatório salvo com esse nome.")).not.toBeInTheDocument();
});

it("o limite de relatorios aparece como aviso do formulario", async () => {
  const { savedApi } = renderPage();
  await screen.findByRole("region", { name: "Despesas por categoria em BRL" });
  savedApi.state.nextError = { status: 409, code: "saved_report_limit_reached" };
  await user.click(screen.getByRole("button", { name: "Salvar relatório" }));
  await user.type(within(dialog()).getByLabelText("Nome"), "Mais um");
  await user.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  expect(await within(dialog()).findByRole("alert")).toHaveTextContent("limite de 30 relatórios");
});

it("com um relatorio aberto, Salvar atualiza por padrao", async () => {
  const { savedApi } = renderPage({ saved: [makeSaved({ name: "Mensal" })] });
  await user.click(await screen.findByRole("button", { name: "Abrir Mensal" }));
  await user.selectOptions(field("Medir"), "income");
  await user.click(screen.getByRole("button", { name: "Salvar relatório" }));
  expect(within(dialog()).getByLabelText("Atualizar “Mensal”")).toBeChecked();
  expect(within(dialog()).getByLabelText("Nome")).toHaveValue("Mensal");
  await user.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(savedApi.writes()).toHaveLength(1));
  expect(savedApi.writes()[0]).toMatchObject({ method: "PUT", id: savedApi.state.reports[0].id, body: { name: "Mensal", measure: "income" } });
  await waitFor(() => expect(screen.queryByText(/com mudanças ainda não salvas/)).not.toBeInTheDocument());
});

it("da para renomear ao atualizar", async () => {
  const { savedApi } = renderPage({ saved: [makeSaved({ name: "Mensal" })] });
  await user.click(await screen.findByRole("button", { name: "Abrir Mensal" }));
  await user.click(screen.getByRole("button", { name: "Salvar relatório" }));
  const name = within(dialog()).getByLabelText("Nome");
  await user.clear(name);
  await user.type(name, "Mensal novo");
  await user.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(savedApi.writes()).toHaveLength(1));
  expect(savedApi.writes()[0]).toMatchObject({ method: "PUT", body: { name: "Mensal novo" } });
});

it("com um relatorio aberto, Salvar como novo cria outro e deixa o primeiro", async () => {
  const { savedApi } = renderPage({ saved: [makeSaved({ name: "Mensal" })] });
  await user.click(await screen.findByRole("button", { name: "Abrir Mensal" }));
  await user.selectOptions(field("Medir"), "income");
  await user.click(screen.getByRole("button", { name: "Salvar relatório" }));
  await user.click(within(dialog()).getByLabelText("Salvar como um relatório novo"));
  const name = within(dialog()).getByLabelText("Nome");
  await user.clear(name);
  await user.type(name, "Receitas");
  await user.click(within(dialog()).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(savedApi.writes()).toHaveLength(1));
  expect(savedApi.writes()[0].method).toBe("POST");
  expect(savedApi.state.reports.map((report) => report.name).sort()).toEqual(["Mensal", "Receitas"]);
  expect(savedApi.state.reports.find((report) => report.name === "Mensal")?.measure).toBe("expense");
});

it("excluir pede confirmacao, apaga e tira o relatorio aberto", async () => {
  const { savedApi } = renderPage({ saved: [makeSaved({ name: "Mensal" }), makeSaved({ name: "Outro" })] });
  await user.click(await screen.findByRole("button", { name: "Abrir Mensal" }));
  await user.click(screen.getByRole("button", { name: "Excluir Mensal" }));
  expect(dialog()).toHaveTextContent("Mensal");
  await user.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
  expect(savedApi.writes()).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Excluir Mensal" }));
  await user.click(within(dialog()).getByRole("button", { name: "Excluir" }));
  await waitFor(() => expect(savedApi.writes()).toHaveLength(1));
  expect(savedApi.writes()[0].method).toBe("DELETE");
  expect(await screen.findByText("Relatório excluído.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Abrir Mensal" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Aberto:/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Abrir Outro" })).toBeInTheDocument();
});

it("Novo relatorio volta ao padrao e solta o aberto", async () => {
  renderPage({ saved: [makeSaved({ name: "Viagens", group_by: "tag", chart: "bar", measure: "income", period: "this-year" })] });
  await user.click(await screen.findByRole("button", { name: "Abrir Viagens" }));
  expect(field("Agrupar por")).toHaveValue("tag");
  await user.click(screen.getByRole("button", { name: "Novo relatório" }));
  expect(field("Agrupar por")).toHaveValue("category");
  expect(field("Gráfico")).toHaveValue("donut");
  expect(field("Período")).toHaveValue("this-month");
  expect(screen.queryByText(/Aberto:/)).not.toBeInTheDocument();
});

it("um relatorio que filtra por algo excluido avisa e nao some em silencio", async () => {
  renderPage({ saved: [makeSaved({ name: "Antigo", category_id: "00000000-0000-4000-8000-00000000dead" })] });
  await user.click(await screen.findByRole("button", { name: "Abrir Antigo" }));
  expect(await screen.findByText(/filtra por categoria que não existe mais/)).toBeInTheDocument();
});

it("erro ao carregar os relatorios salvos tem botao de tentar de novo", async () => {
  const { savedApi } = renderPage();
  savedApi.state.listError = true;
  const panel = await screen.findByRole("region", { name: "Relatórios salvos" });
  await within(panel).findByRole("button", { name: "Tentar de novo" });
  savedApi.state.listError = false;
  await user.click(within(panel).getByRole("button", { name: "Tentar de novo" }));
  expect(await within(panel).findByText(/Você ainda não salvou nenhum relatório/)).toBeInTheDocument();
});
