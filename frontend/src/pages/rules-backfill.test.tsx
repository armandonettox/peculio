import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import type { RulePreviewItem } from "@/api/rules";
import { BackfillDialog } from "@/features/rules/backfill-dialog";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import { fakeBillsApi, makeBill } from "@/test-utils/bills-api";
import { fakeBudgetsApi, makeBudget } from "@/test-utils/budgets-api";
import { fakeLabelsApi, makeLabel } from "@/test-utils/labels-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { fakeRulesApi, makeRule } from "@/test-utils/rules-api";
import RulesPage from "./rules";

const account = makeAccount({ name: "Nubank" });
const otherAccount = makeAccount({ name: "Itau" });
const category = makeLabel({ name: "Mercado" });
const tag = makeLabel({ name: "casa" });
const budget = makeBudget({ name: "Casa" });
const bill = makeBill({ name: "Netflix" });

const mercado = makeRule({ name: "Mercado", actions: [{ kind: "set_category", target_id: category.id }] });
const lazer = makeRule({ name: "Lazer" });
const pausada = makeRule({ name: "Pausada", active: false });

function item(overrides: Partial<RulePreviewItem> = {}): RulePreviewItem {
  return {
    transaction_id: "t0000000-0000-4000-8000-000000000001",
    split_id: "s0000000-0000-4000-8000-000000000001",
    date: "2026-03-10",
    description: "Compra no mercado",
    amount: "120.50",
    currency_code: "BRL",
    category_id: category.id,
    budget_id: null,
    bill_id: null,
    add_tag_ids: [],
    rule_ids: [mercado.id],
    ...overrides,
  };
}

function renderPage(rules = [mercado, lazer, pausada]) {
  const api = fakeRulesApi({ rules });
  server.use(
    ...api.handlers,
    ...fakeAccountsApi([account, otherAccount]).handlers,
    ...fakeLabelsApi("categories", [category]).handlers,
    ...fakeLabelsApi("tags", [tag]).handlers,
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

const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());

async function openBackfill() {
  await screen.findByRole("heading", { level: 3, name: "Mercado" });
  await userEvent.click(screen.getByRole("button", { name: "Aplicar nas antigas" }));
}

const previewButton = () => inDialog().getByRole("button", { name: "Ver prévia" });
const previews = (api: ReturnType<typeof renderPage>) => api.mutations().filter((r) => r.path === "/rules/preview");
const applies = (api: ReturnType<typeof renderPage>) => api.mutations().filter((r) => r.path === "/rules/apply");

it("abre o dialogo e lista so as regras ativas, todas marcadas", async () => {
  renderPage();
  await openBackfill();
  expect(inDialog().getByRole("heading", { name: "Aplicar nas transações antigas" })).toBeInTheDocument();
  expect(inDialog().getByLabelText("Mercado")).toBeChecked();
  expect(inDialog().getByLabelText("Lazer")).toBeChecked();
  expect(inDialog().queryByLabelText("Pausada")).not.toBeInTheDocument();
});

it("sem regras ativas avisa e nao deixa pedir a previa", async () => {
  renderPage([pausada, makeRule({ name: "Mercado", active: false })]);
  await screen.findByRole("heading", { level: 3, name: "Pausada" });
  await userEvent.click(screen.getByRole("button", { name: "Aplicar nas antigas" }));
  expect(inDialog().getByText("Você não tem regras ativas para aplicar.")).toBeInTheDocument();
  expect(previewButton()).toBeDisabled();
});

it("a previa sem filtros manda corpo vazio e mostra o resumo e cada lancamento", async () => {
  const api = renderPage();
  api.state.preview = {
    scanned: 5,
    changed: 2,
    truncated: false,
    items: [
      item(),
      item({
        split_id: "s0000000-0000-4000-8000-000000000002",
        description: "Assinatura",
        amount: "39.90",
        date: "2026-03-05",
        category_id: null,
        budget_id: budget.id,
        bill_id: bill.id,
        add_tag_ids: [tag.id],
      }),
    ],
  };
  await openBackfill();
  await userEvent.click(previewButton());
  expect(await inDialog().findByText("2 lançamentos seriam alterados de 5.")).toBeInTheDocument();
  expect(previews(api)[0].body).toEqual({});

  const preview = within(inDialog().getByRole("region", { name: "Prévia" }));
  expect(preview.getByText("Compra no mercado")).toBeInTheDocument();
  expect(preview.getByText("10/03/2026 · R$ 120,50")).toBeInTheDocument();
  expect(preview.getByText("Categoria: Mercado")).toBeInTheDocument();
  expect(preview.getByText("05/03/2026 · R$ 39,90")).toBeInTheDocument();
  expect(preview.getByText("Orçamento: Casa")).toBeInTheDocument();
  expect(preview.getByText("Conta a pagar: Netflix")).toBeInTheDocument();
  expect(preview.getByText("Tag: casa")).toBeInTheDocument();
  expect(inDialog().getByRole("button", { name: "Aplicar em 2 lançamentos" })).toBeInTheDocument();
  // Ver a previa nao grava nada
  expect(applies(api)).toHaveLength(0);
});

it("um so lancamento fica no singular", async () => {
  const api = renderPage();
  api.state.preview = { scanned: 1, changed: 1, truncated: false, items: [item()] };
  await openBackfill();
  await userEvent.click(previewButton());
  expect(await inDialog().findByText("1 lançamento seria alterado de 1.")).toBeInTheDocument();
  expect(inDialog().getByRole("button", { name: "Aplicar em 1 lançamento" })).toBeInTheDocument();
});

it("sem nada para mudar avisa e nao oferece aplicar", async () => {
  const api = renderPage();
  api.state.preview = { scanned: 3, changed: 0, truncated: false, items: [] };
  await openBackfill();
  await userEvent.click(previewButton());
  expect(await inDialog().findByText("Nada para preencher em 3 lançamentos.")).toBeInTheDocument();
  expect(inDialog().queryByRole("button", { name: /^Aplicar em/ })).not.toBeInTheDocument();
});

it("previa cortada avisa que a aplicacao vale para todos", async () => {
  const api = renderPage();
  api.state.preview = { scanned: 900, changed: 450, truncated: true, items: [item()] };
  await openBackfill();
  await userEvent.click(previewButton());
  expect(await inDialog().findByText("Mostrando os primeiros 1. A aplicação vale para todos os 450.")).toBeInTheDocument();
  expect(inDialog().getByRole("button", { name: "Aplicar em 450 lançamentos" })).toBeInTheDocument();
});

it("aplica com o mesmo corpo da previa e mostra o resultado", async () => {
  const api = renderPage();
  api.state.preview = { scanned: 4, changed: 2, truncated: false, items: [item()] };
  api.state.applied = { scanned: 4, changed: 2 };
  await openBackfill();
  await userEvent.type(inDialog().getByLabelText("De"), "2026-03-01");
  await userEvent.type(inDialog().getByLabelText("Até"), "2026-03-31");
  await userEvent.selectOptions(inDialog().getByLabelText("Conta"), "Nubank");
  await userEvent.click(previewButton());
  await userEvent.click(await inDialog().findByRole("button", { name: "Aplicar em 2 lançamentos" }));
  expect(await inDialog().findByText("Pronto: 2 lançamentos atualizados.")).toBeInTheDocument();
  const body = { date_from: "2026-03-01", date_to: "2026-03-31", account_id: account.id };
  expect(previews(api)[0].body).toEqual(body);
  expect(applies(api)[0].body).toEqual(body);
  // Depois de aplicar so resta fechar
  expect(inDialog().queryByRole("button", { name: /^Aplicar em/ })).not.toBeInTheDocument();
  // O X do canto tambem se chama Fechar; o do rodape e o ultimo
  await userEvent.click(inDialog().getAllByRole("button", { name: "Fechar" }).at(-1)!);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("so uma data tambem vale e os campos vazios nao vao no corpo", async () => {
  const api = renderPage();
  await openBackfill();
  await userEvent.type(inDialog().getByLabelText("Até"), "2026-03-31");
  await userEvent.click(previewButton());
  await waitFor(() => expect(previews(api)).toHaveLength(1));
  expect(previews(api)[0].body).toEqual({ date_to: "2026-03-31" });
});

it("escolher so algumas regras manda a lista de ids", async () => {
  const api = renderPage();
  await openBackfill();
  await userEvent.click(inDialog().getByLabelText("Lazer"));
  await userEvent.click(previewButton());
  await waitFor(() => expect(previews(api)).toHaveLength(1));
  expect(previews(api)[0].body).toEqual({ rule_ids: [mercado.id] });
});

it("desmarcar tudo desabilita a previa e marcar de novo volta a mandar sem lista", async () => {
  const api = renderPage();
  await openBackfill();
  await userEvent.click(inDialog().getByLabelText("Mercado"));
  await userEvent.click(inDialog().getByLabelText("Lazer"));
  expect(previewButton()).toBeDisabled();
  await userEvent.click(inDialog().getByLabelText("Mercado"));
  await userEvent.click(inDialog().getByLabelText("Lazer"));
  await userEvent.click(previewButton());
  await waitFor(() => expect(previews(api)).toHaveLength(1));
  expect(previews(api)[0].body).toEqual({});
});

it("data inicial depois da final mostra o erro e desabilita a previa", async () => {
  renderPage();
  await openBackfill();
  await userEvent.type(inDialog().getByLabelText("De"), "2026-05-01");
  await userEvent.type(inDialog().getByLabelText("Até"), "2026-04-01");
  expect(inDialog().getByText("A data inicial não pode ser depois da final.")).toBeInTheDocument();
  expect(previewButton()).toBeDisabled();
  await userEvent.clear(inDialog().getByLabelText("De"));
  await userEvent.type(inDialog().getByLabelText("De"), "2026-04-01");
  expect(previewButton()).toBeEnabled();
});

it("mudar um filtro depois da previa esconde a previa e o botao de aplicar", async () => {
  const api = renderPage();
  api.state.preview = { scanned: 2, changed: 2, truncated: false, items: [item()] };
  await openBackfill();
  await userEvent.click(previewButton());
  await inDialog().findByRole("button", { name: "Aplicar em 2 lançamentos" });
  await userEvent.selectOptions(inDialog().getByLabelText("Conta"), "Itau");
  expect(inDialog().queryByRole("region", { name: "Prévia" })).not.toBeInTheDocument();
  expect(inDialog().queryByRole("button", { name: /^Aplicar em/ })).not.toBeInTheDocument();
  await userEvent.click(inDialog().getByLabelText("Lazer"));
  await userEvent.click(previewButton());
  await inDialog().findByRole("button", { name: "Aplicar em 2 lançamentos" });
  await userEvent.click(inDialog().getByLabelText("Mercado"));
  expect(inDialog().queryByRole("region", { name: "Prévia" })).not.toBeInTheDocument();
});

it("lancamentos demais: mostra o erro do servidor e nao mostra previa", async () => {
  const api = renderPage();
  api.state.nextMutationError = { status: 422, code: "rule_run_too_large" };
  await openBackfill();
  await userEvent.click(previewButton());
  expect(await inDialog().findByText("Lançamentos demais de uma vez. Escolha um período ou uma conta menor.")).toBeInTheDocument();
  expect(inDialog().queryByRole("region", { name: "Prévia" })).not.toBeInTheDocument();
});

it("erro ao aplicar mostra o aviso, mantem a previa e deixa tentar de novo", async () => {
  const api = renderPage();
  api.state.preview = { scanned: 2, changed: 2, truncated: false, items: [item()] };
  api.state.applied = { scanned: 2, changed: 2 };
  await openBackfill();
  await userEvent.click(previewButton());
  const apply = await inDialog().findByRole("button", { name: "Aplicar em 2 lançamentos" });
  api.state.nextMutationError = { status: 422, code: "rule_invalid" };
  await userEvent.click(apply);
  expect(await inDialog().findByText(/cita algo que não existe mais/)).toBeInTheDocument();
  expect(inDialog().getByRole("region", { name: "Prévia" })).toBeInTheDocument();
  expect(inDialog().queryByText(/Pronto:/)).not.toBeInTheDocument();

  await userEvent.click(inDialog().getByRole("button", { name: "Aplicar em 2 lançamentos" }));
  expect(await inDialog().findByText("Pronto: 2 lançamentos atualizados.")).toBeInTheDocument();
  expect(inDialog().queryByText(/cita algo que não existe mais/)).not.toBeInTheDocument();
});

it("erro na previa depois de uma previa boa esconde a antiga: nao se aplica o que nao foi mostrado", async () => {
  const api = renderPage();
  api.state.preview = { scanned: 2, changed: 2, truncated: false, items: [item()] };
  await openBackfill();
  await userEvent.click(previewButton());
  await inDialog().findByRole("button", { name: "Aplicar em 2 lançamentos" });
  api.state.nextMutationError = { status: 404, code: "account_not_found" };
  await userEvent.click(previewButton());
  expect(await inDialog().findByText("Conta não encontrada.")).toBeInTheDocument();
  expect(inDialog().queryByRole("region", { name: "Prévia" })).not.toBeInTheDocument();
  expect(inDialog().queryByRole("button", { name: /^Aplicar em/ })).not.toBeInTheDocument();
});

it("cancelar fecha sem aplicar nada", async () => {
  const api = renderPage();
  api.state.preview = { scanned: 2, changed: 2, truncated: false, items: [item()] };
  await openBackfill();
  await userEvent.click(previewButton());
  await inDialog().findByRole("button", { name: "Aplicar em 2 lançamentos" });
  await userEvent.click(inDialog().getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(applies(api)).toHaveLength(0);
});

// ---------- Regras que chegam depois de o dialogo abrir ----------

it("o botao de aplicar nas antigas espera as regras carregarem", async () => {
  const api = fakeRulesApi({ rules: [mercado] });
  server.use(
    http.get("*/api/v1/rules", async () => {
      await delay(300);
      return HttpResponse.json({ items: [mercado], total: 1, limit: 200, offset: 0 });
    }),
    ...api.handlers,
    ...fakeAccountsApi([account]).handlers,
    ...fakeLabelsApi("categories", [category]).handlers,
    ...fakeLabelsApi("tags", [tag]).handlers,
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
  expect(screen.getByRole("button", { name: "Aplicar nas antigas" })).toBeDisabled();
  await screen.findByRole("heading", { level: 3, name: "Mercado" });
  expect(screen.getByRole("button", { name: "Aplicar nas antigas" })).toBeEnabled();
});

it("regras que chegam depois de o dialogo abrir ja aparecem marcadas e a previa fica habilitada", () => {
  const lookups = { accounts: new Map(), categories: new Map(), tags: new Map(), budgets: new Map(), bills: new Map() };
  const { rerender } = render(
    <FakeAuth>
      <MemoryRouter>
        <BackfillDialog rules={[]} lookups={lookups} onClose={() => undefined} />
      </MemoryRouter>
    </FakeAuth>,
  );
  expect(previewButton()).toBeDisabled();
  rerender(
    <FakeAuth>
      <MemoryRouter>
        <BackfillDialog rules={[mercado, lazer, pausada]} lookups={lookups} onClose={() => undefined} />
      </MemoryRouter>
    </FakeAuth>,
  );
  expect(inDialog().getByLabelText("Mercado")).toBeChecked();
  expect(inDialog().getByLabelText("Lazer")).toBeChecked();
  expect(previewButton()).toBeEnabled();
});

it("o que a pessoa desmarcou continua desmarcado quando a lista de regras muda", async () => {
  const lookups = { accounts: new Map(), categories: new Map(), tags: new Map(), budgets: new Map(), bills: new Map() };
  const { rerender } = render(
    <FakeAuth>
      <MemoryRouter>
        <BackfillDialog rules={[mercado, lazer]} lookups={lookups} onClose={() => undefined} />
      </MemoryRouter>
    </FakeAuth>,
  );
  await userEvent.click(inDialog().getByLabelText("Lazer"));
  expect(inDialog().getByLabelText("Lazer")).not.toBeChecked();
  const nova = makeRule({ name: "Nova regra" });
  rerender(
    <FakeAuth>
      <MemoryRouter>
        <BackfillDialog rules={[mercado, lazer, nova]} lookups={lookups} onClose={() => undefined} />
      </MemoryRouter>
    </FakeAuth>,
  );
  expect(inDialog().getByLabelText("Lazer")).not.toBeChecked();
  expect(inDialog().getByLabelText("Mercado")).toBeChecked();
  expect(inDialog().getByLabelText("Nova regra")).toBeChecked();
});
