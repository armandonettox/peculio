import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { LineChartProps } from "@/components/charts";
import { monthRange } from "@/lib/month";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBudgetsApi } from "@/test-utils/budgets-api";
import { fakeLabelsApi } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeTransactionsApi } from "@/test-utils/transactions-api";
import { makeTransaction } from "@/test-utils/transaction-fixtures";
import { FirstStepsBlock } from "./first-steps-block";
import { CalendarBlock, FrequencyBlock } from "./month-blocks";
import { PendingBlock } from "./list-blocks";

const barCalls: LineChartProps[] = [];

vi.mock("@/components/charts", () => ({
  BarChart: (props: LineChartProps) => {
    barCalls.push(props);
    return <div role="img" aria-label={props.title} data-chart="bar" />;
  },
}));

beforeEach(() => {
  barCalls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 15, 12));
});
afterEach(() => vi.useRealTimers());

const march = monthRange("2026-03-15");

function renderBlock(ui: React.ReactElement, transactions = [makeTransaction()], accounts = [makeAccount()]) {
  const transactionsApi = fakeTransactionsApi(transactions, accounts);
  server.use(
    ...fakeAccountsApi(accounts).handlers,
    ...transactionsApi.handlers,
    ...fakeLabelsApi("categories", []).handlers,
    ...fakeBudgetsApi([]).handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>{ui}</MemoryRouter>
    </FakeAuth>,
  );
}

it("calendario: so os dias com movimento viram link, e levam a lista daquele dia", async () => {
  renderBlock(<CalendarBlock range={march} />, [
    makeTransaction({}, [{ date: "2026-03-05" }]),
    makeTransaction({}, [{ date: "2026-03-05" }]),
    makeTransaction({}, [{ date: "2026-03-20" }]),
  ]);
  const day5 = await screen.findByRole("link", { name: "Dia 5, 2 lançamentos" });
  expect(day5).toHaveAttribute("href", "/transacoes?de=2026-03-05&ate=2026-03-05");
  expect(screen.getByRole("link", { name: "Dia 20, 1 lançamento" })).toBeInTheDocument();
  expect(screen.getAllByRole("link")).toHaveLength(2);
});

it("calendario: marco de 2026 comeca no domingo e tem 31 dias", async () => {
  renderBlock(<CalendarBlock range={march} />);
  const grid = await screen.findByRole("grid");
  // 1 de marco de 2026 e domingo: sem celula vazia antes do dia 1
  const cells = within(grid).getAllByRole("gridcell");
  expect(cells).toHaveLength(31);
  expect(cells[0]).toHaveTextContent("1");
});

it("frequencia: conta as despesas por dia da semana (ignora receita e fora do mes)", async () => {
  renderBlock(<FrequencyBlock range={march} />, [
    makeTransaction({}, [{ date: "2026-03-02" }]),
    makeTransaction({}, [{ date: "2026-03-09" }]),
    makeTransaction({}, [{ date: "2026-03-10" }]),
    makeTransaction({}, [{ date: "2026-03-11", type: "deposit" }]),
    makeTransaction({}, [{ date: "2026-02-23" }]),
  ]);
  await waitFor(() => expect(barCalls.length).toBeGreaterThan(0));
  const points = barCalls[barCalls.length - 1].series[0].points;
  // Duas segundas (2 e 9) e uma terca (10); domingo e os outros dias ficam em zero
  expect(points.map((point) => point.value)).toEqual(["0", "2", "1", "0", "0", "0", "0"]);
  // O eixo e de contagem: valor inteiro tem rotulo, fracao (0,25) nao
  const { formatValue } = barCalls[barCalls.length - 1];
  expect(formatValue("2")).toBe("2 despesas");
  expect(formatValue("0.25")).toBe("");
});

it("pendentes: lista os lancamentos nao efetivados do mes com link para a lista filtrada", async () => {
  renderBlock(<PendingBlock range={march} />, [
    makeTransaction({ title: "Conta de luz" }, [{ date: "2026-03-18", is_paid: false }]),
    makeTransaction({ title: "Ja pago" }, [{ date: "2026-03-10", is_paid: true }]),
  ]);
  expect(await screen.findByText("Conta de luz")).toBeInTheDocument();
  expect(screen.queryByText("Ja pago")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ver mais" })).toHaveAttribute("href", "/transacoes?situacao=pending&de=2026-03-01&ate=2026-03-31");
});

it("primeiros passos: mostra o progresso e o que falta; some quando tudo esta feito", async () => {
  const card = makeAccount({ id: "c0000000-0000-4000-8000-000000000009", name: "Cartao", role: "credit_card", type: "asset" });
  const budgetsApi = fakeBudgetsApi([]);
  server.use(
    ...fakeAccountsApi([makeAccount(), card]).handlers,
    ...fakeTransactionsApi([makeTransaction()], [makeAccount()]).handlers,
    ...budgetsApi.handlers,
  );
  render(
    <FakeAuth>
      <MemoryRouter>
        <FirstStepsBlock />
      </MemoryRouter>
    </FakeAuth>,
  );
  const section = await screen.findByRole("region", { name: "Primeiros passos" });
  // Conta, cartao e lancamento feitos; falta o orcamento
  expect(within(section).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  expect(within(section).getByRole("link", { name: "Crie um orçamento" })).toHaveAttribute("href", "/orcamentos");
});
