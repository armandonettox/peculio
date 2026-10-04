import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { IMPORT_MAX_BYTES } from "@/api/imports";
import { fakeAccountsApi, makeAccount } from "@/test-utils/accounts-api";
import {
  fakeImportsApi,
  makeNeedsMapping,
  makeOfxPreview,
  makePreview,
  makeRow,
} from "@/test-utils/imports-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import ImportPage from "./import";

const nubank = makeAccount({ id: "a0000000-0000-4000-8000-000000000001", name: "Nubank" });
const wise = makeAccount({ id: "a0000000-0000-4000-8000-000000000002", name: "Wise", currency_code: "USD" });
const financiamento = makeAccount({
  id: "a0000000-0000-4000-8000-000000000003",
  name: "Financiamento",
  type: "liability",
  role: "mortgage",
});
const arquivada = makeAccount({ id: "a0000000-0000-4000-8000-000000000004", name: "Antiga", active: false });

type Options = { accounts?: ReturnType<typeof makeAccount>[] };

function renderPage(previews: Parameters<typeof fakeImportsApi>[0] = [], { accounts = [nubank, wise, financiamento, arquivada] }: Options = {}) {
  const api = fakeImportsApi(previews);
  server.use(...api.handlers, ...fakeAccountsApi(accounts).handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <ImportPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  return api;
}

const csvFile = (name = "extrato.csv", text = "Data;Descricao;Valor\n05/03/2026;Compra;-50,00\n") =>
  new File([text], name, { type: "text/csv" });

async function pickAccountAndFile(account = "Nubank", file = csvFile()) {
  await userEvent.selectOptions(await screen.findByLabelText("Conta que recebe o extrato"), screen.getByRole("option", { name: new RegExp(`^${account}`) }));
  await userEvent.upload(screen.getByLabelText("Arquivo do extrato (CSV ou OFX)"), file);
}

const readPreview = async () => userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
const money = (text: string) => text.replace(/\s/g, " ");

const sampleRows = () => [
  makeRow({ index: 2, description: "Mercado Bom Preco", amount: "-50.00", date: "2026-03-05" }),
  makeRow({ index: 3, description: "Salario", amount: "1000.00", date: "2026-03-06" }),
  makeRow({
    index: 4,
    description: "Padaria",
    amount: "-12.50",
    date: "2026-03-07",
    status: "duplicate",
    duplicate_kind: "similar",
    reason: "Ja existe um lancamento igual nesta conta, no mesmo dia e com o mesmo valor",
  }),
  makeRow({ index: 5, description: "Data ruim", amount: null, date: null, status: "error", reason: "Data inexistente" }),
];

const rowOf = (line: number) => screen.getByRole("checkbox", { name: `Importar a linha ${line}` }).closest("tr") as HTMLElement;
const importButton = () => screen.getByRole("button", { name: /^Importar \d+ lançamento|^Nada marcado/ });

// ---------- Passo 1: arquivo ----------

it("lista so contas de ativo ativas, com a moeda", async () => {
  renderPage();
  const select = await screen.findByLabelText("Conta que recebe o extrato");
  const options = within(select).getAllByRole("option").map((option) => option.textContent);
  expect(options).toEqual(["Escolha uma conta", "Nubank (BRL)", "Wise (USD)"]);
});

it("com uma conta so ela ja vem escolhida", async () => {
  renderPage([], { accounts: [nubank, financiamento] });
  const select = (await screen.findByLabelText("Conta que recebe o extrato")) as HTMLSelectElement;
  expect(select.value).toBe(nubank.id);
});

it("sem conta de ativo avisa e leva para criar uma", async () => {
  renderPage([], { accounts: [financiamento] });
  expect(await screen.findByText(/Você ainda não tem uma conta para receber o extrato/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Crie uma conta" })).toHaveAttribute("href", "/contas");
  expect(screen.queryByRole("button", { name: "Ver prévia" })).not.toBeInTheDocument();
});

it("sem conta nem arquivo mostra os dois avisos e nao chama a API", async () => {
  const api = renderPage();
  await screen.findByLabelText("Conta que recebe o extrato");
  await readPreview();
  expect(screen.getByText("Escolha a conta que vai receber o extrato.")).toBeInTheDocument();
  expect(screen.getByText("Escolha o arquivo do extrato.")).toBeInTheDocument();
  expect(api.state.previewCalls).toHaveLength(0);
});

it("o aviso some quando a pessoa escolhe", async () => {
  renderPage();
  await screen.findByLabelText("Conta que recebe o extrato");
  await readPreview();
  await pickAccountAndFile();
  expect(screen.queryByText("Escolha a conta que vai receber o extrato.")).not.toBeInTheDocument();
  expect(screen.queryByText("Escolha o arquivo do extrato.")).not.toBeInTheDocument();
});

it("arquivo vazio e arquivo grande demais sao recusados no navegador", async () => {
  const api = renderPage();
  await pickAccountAndFile("Nubank", new File([], "vazio.csv"));
  await readPreview();
  expect(screen.getByText("O arquivo está vazio.")).toBeInTheDocument();

  const big = csvFile("grande.csv");
  Object.defineProperty(big, "size", { value: IMPORT_MAX_BYTES + 1 });
  await userEvent.upload(screen.getByLabelText("Arquivo do extrato (CSV ou OFX)"), big);
  await readPreview();
  expect(screen.getByText("O arquivo passa do limite de 5 MB.")).toBeInTheDocument();

  const exact = csvFile("no-limite.csv");
  Object.defineProperty(exact, "size", { value: IMPORT_MAX_BYTES });
  await userEvent.upload(screen.getByLabelText("Arquivo do extrato (CSV ou OFX)"), exact);
  expect(screen.queryByText("O arquivo passa do limite de 5 MB.")).not.toBeInTheDocument();
  expect(api.state.previewCalls).toHaveLength(0);
});

it("um arquivo exatamente no limite de tamanho e lido", async () => {
  const api = renderPage([makePreview(sampleRows())]);
  const exact = csvFile("no-limite.csv");
  Object.defineProperty(exact, "size", { value: IMPORT_MAX_BYTES });
  await pickAccountAndFile("Nubank", exact);
  await readPreview();
  await screen.findByText(/\d+ novas?/);
  expect(screen.queryByText("O arquivo passa do limite de 5 MB.")).not.toBeInTheDocument();
  expect(api.state.previewCalls).toHaveLength(1);
});

it("mostra o nome e o tamanho do arquivo escolhido e permite trocar", async () => {
  renderPage();
  await pickAccountAndFile("Nubank", csvFile("janeiro.csv"));
  expect(screen.getByText(/janeiro\.csv/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Trocar arquivo" })).toBeInTheDocument();
});

it("envia a conta e o arquivo, sem colunas na primeira vez", async () => {
  const api = renderPage([makePreview(sampleRows())]);
  await pickAccountAndFile("Wise", csvFile("fevereiro.csv"));
  await readPreview();
  await screen.findByText(/\d+ novas?/);
  // O nome e o conteudo do arquivo nao chegam ao fake (o File do jsdom nao e o do undici): quem confere o
  // arquivo de verdade e o E2E, no navegador
  expect(api.state.previewCalls).toHaveLength(1);
  expect(api.state.previewCalls[0]).toMatchObject({ accountId: wise.id, mapping: null });
});

it("mostra que esta lendo e trava o botao enquanto espera", async () => {
  const api = renderPage([makePreview(sampleRows())]);
  api.state.holdPreview = true;
  await pickAccountAndFile();
  await readPreview();
  const button = await screen.findByRole("button", { name: "Lendo o arquivo..." });
  expect(button).toBeDisabled();
  api.state.release?.();
  await screen.findByText(/\d+ novas?/);
});

it("arquivo recusado pelo servidor mostra o motivo e continua no primeiro passo", async () => {
  const api = renderPage([makePreview(sampleRows())]);
  api.state.nextPreviewError = { status: 422, code: "import_file_invalid", detail: "O arquivo esta em USD e a conta em BRL: escolha uma conta na mesma moeda" };
  await pickAccountAndFile();
  await readPreview();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Não foi possível ler o arquivo: O arquivo esta em USD e a conta em BRL: escolha uma conta na mesma moeda",
  );
  expect(screen.getByRole("button", { name: "Ver prévia" })).toBeInTheDocument();
  expect(screen.getByText(/extrato\.csv/)).toBeInTheDocument();
});

it("outros erros usam a mensagem em portugues do codigo", async () => {
  const api = renderPage([makePreview(sampleRows())]);
  api.state.nextPreviewError = { status: 400, code: "import_account_invalid" };
  await pickAccountAndFile();
  await readPreview();
  expect(await screen.findByRole("alert")).toHaveTextContent("O extrato só pode ser importado em uma conta de ativo, não em uma dívida.");
});

it("arquivo com linhas demais mostra o motivo do servidor", async () => {
  const api = renderPage();
  api.state.nextPreviewError = { status: 422, code: "import_too_many_rows", detail: "O arquivo tem mais de 5000 linhas: divida em partes" };
  await pickAccountAndFile();
  await readPreview();
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível ler o arquivo: O arquivo tem mais de 5000 linhas");
});

it("arquivo grande demais para o servidor usa a mensagem do codigo", async () => {
  const api = renderPage();
  api.state.nextPreviewError = { status: 413, code: "import_file_too_large" };
  await pickAccountAndFile();
  await readPreview();
  expect(await screen.findByRole("alert")).toHaveTextContent("O arquivo passa do limite de 5 MB.");
});

// ---------- Passo 3: previa ----------

async function openPreview(rows = sampleRows(), account = "Nubank") {
  const api = renderPage([makePreview(rows)]);
  await pickAccountAndFile(account);
  await readPreview();
  await screen.findByText(/\d+ novas?/);
  return api;
}

it("resume as contagens e mostra cada linha com data, valor na moeda da conta e situacao por escrito", async () => {
  await openPreview();
  expect(screen.getByRole("status")).toHaveTextContent("2 novas · 1 repetida · 1 com erro · conta Nubank");

  const market = rowOf(2);
  expect(within(market).getByText("Mercado Bom Preco")).toBeInTheDocument();
  expect(within(market).getByText("05/03/2026")).toBeInTheDocument();
  expect(money(within(market).getByText(/50,00/).textContent ?? "")).toContain("R$ 50,00");
  expect(within(market).getByText("Nova")).toBeInTheDocument();

  const salary = rowOf(3);
  expect(money(within(salary).getByText(/1\.000,00/).textContent ?? "")).toBe("R$ 1.000,00");
  expect(within(salary).getByText(/1\.000,00/)).toHaveClass("text-positive");
  expect(within(market).getByText(/50,00/)).not.toHaveClass("text-positive");
});

it("usa a moeda da conta escolhida", async () => {
  await openPreview(sampleRows(), "Wise");
  expect(within(rowOf(3)).getByText(/1\.000,00/).textContent).toContain("US$");
});

it("novas vem marcadas, repetidas desmarcadas e a com erro desabilitada, cada uma com o seu motivo", async () => {
  await openPreview();
  expect(screen.getByRole("checkbox", { name: "Importar a linha 2" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Importar a linha 3" })).toBeChecked();
  const duplicate = screen.getByRole("checkbox", { name: "Importar a linha 4" });
  expect(duplicate).not.toBeChecked();
  expect(duplicate).toBeEnabled();
  const failed = screen.getByRole("checkbox", { name: "Importar a linha 5" });
  expect(failed).not.toBeChecked();
  expect(failed).toBeDisabled();

  expect(within(rowOf(4)).getByText("Parece repetida")).toBeInTheDocument();
  expect(within(rowOf(4)).getByText(/Ja existe um lancamento igual/)).toBeInTheDocument();
  expect(within(rowOf(5)).getByText("Erro")).toBeInTheDocument();
  expect(within(rowOf(5)).getByText("Data inexistente")).toHaveClass("text-destructive");
  expect(within(rowOf(5)).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/vêm desmarcadas/)).toBeInTheDocument();
});

it("o aviso das repetidas so aparece quando ha repetidas", async () => {
  await openPreview([makeRow({ index: 2 })]);
  expect(screen.queryByText(/vêm desmarcadas/)).not.toBeInTheDocument();
});

it("diferencia 'Já importada' (mesmo identificador do banco) de 'Parece repetida'", async () => {
  await openPreview([
    makeRow({ index: 2, status: "duplicate", duplicate_kind: "same_id", external_id: "F1", reason: "Este lancamento ja foi importado antes (mesmo identificador do banco)" }),
  ]);
  expect(within(rowOf(2)).getByText("Já importada")).toBeInTheDocument();
});

it("o botao diz quantos lancamentos vao entrar e acompanha as marcacoes", async () => {
  await openPreview();
  expect(importButton()).toHaveTextContent("Importar 2 lançamentos");
  await userEvent.click(screen.getByRole("checkbox", { name: "Importar a linha 2" }));
  expect(importButton()).toHaveTextContent("Importar 1 lançamento");
  expect(importButton().textContent).not.toContain("lançamentos");
  await userEvent.click(screen.getByRole("checkbox", { name: "Importar a linha 4" }));
  expect(importButton()).toHaveTextContent("Importar 2 lançamentos");
});

it("marcar so as novas, marcar todas e desmarcar tudo", async () => {
  await openPreview();
  await userEvent.click(screen.getByRole("button", { name: "Marcar todas (inclui repetidas)" }));
  expect(importButton()).toHaveTextContent("Importar 3 lançamentos");
  // A linha com erro continua de fora, mesmo marcando todas
  expect(screen.getByRole("checkbox", { name: "Importar a linha 5" })).not.toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Marcar só as novas" }));
  expect(importButton()).toHaveTextContent("Importar 2 lançamentos");
  expect(screen.getByRole("checkbox", { name: "Importar a linha 4" })).not.toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Desmarcar tudo" }));
  expect(importButton()).toHaveTextContent("Nada marcado para importar");
  expect(importButton()).toBeDisabled();
});

it("pagina a previa de 100 em 100 e as marcacoes valem entre as paginas", async () => {
  const many = Array.from({ length: 250 }, (_, n) => makeRow({ index: n + 2, description: `Item ${n + 2}` }));
  await openPreview(many);
  expect(screen.getByText("Linhas 1 a 100 de 250")).toBeInTheDocument();
  expect(screen.getAllByRole("checkbox")).toHaveLength(100);
  expect(screen.queryByText("Item 102")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

  await userEvent.click(screen.getByRole("checkbox", { name: "Importar a linha 2" }));
  await userEvent.click(screen.getByRole("button", { name: "Próxima" }));
  expect(screen.getByText("Linhas 101 a 200 de 250")).toBeInTheDocument();
  expect(screen.getByText("Item 102")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Próxima" }));
  expect(screen.getByText("Linhas 201 a 250 de 250")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Próxima" })).toBeDisabled();
  expect(importButton()).toHaveTextContent("Importar 249 lançamentos");

  await userEvent.click(screen.getByRole("button", { name: "Anterior" }));
  await userEvent.click(screen.getByRole("button", { name: "Anterior" }));
  expect(screen.getByRole("checkbox", { name: "Importar a linha 2" })).not.toBeChecked();
});

it("com poucas linhas nao mostra a paginacao", async () => {
  await openPreview();
  expect(screen.queryByRole("button", { name: "Próxima" })).not.toBeInTheDocument();
});

it("todas as linhas com erro: nada para importar", async () => {
  await openPreview([makeRow({ index: 2, status: "error", amount: null, date: null, reason: "Valor invalido" })]);
  expect(importButton()).toBeDisabled();
  expect(importButton()).toHaveTextContent("Nada marcado para importar");
});

// ---------- Confirmar ----------

it("confirma so as linhas marcadas, com identificador do banco, e mostra o resultado", async () => {
  const rows = [
    makeRow({ index: 1, description: "Compra", amount: "-50.00", date: "2026-03-05", external_id: "F1" }),
    makeRow({ index: 2, description: "Salario", amount: "1000.00", date: "2026-03-06", external_id: "F2" }),
    makeRow({ index: 3, description: "Repetida", status: "duplicate", duplicate_kind: "similar", reason: "igual" }),
    makeRow({ index: 4, description: "Quebrada", status: "error", amount: null, date: null, reason: "Valor invalido" }),
  ];
  const api = renderPage([makeOfxPreview(rows)]);
  await pickAccountAndFile("Nubank", new File(["OFXHEADER"], "extrato.ofx"));
  await readPreview();
  await screen.findByText(/\d+ novas?/);
  await userEvent.click(screen.getByRole("checkbox", { name: "Importar a linha 1" }));
  await userEvent.click(importButton());

  expect(await screen.findByRole("heading", { name: "1 lançamento importados" })).toBeInTheDocument();
  expect(api.confirms()).toHaveLength(1);
  expect(api.confirms()[0].body).toEqual({
    account_id: nubank.id,
    rows: [{ date: "2026-03-06", description: "Salario", amount: "1000.00", external_id: "F2" }],
  });
});

it("com uma conta so, a escolhida sozinha vai tanto na previa quanto na confirmacao", async () => {
  const api = renderPage([makePreview(sampleRows())], { accounts: [wise] });
  await userEvent.upload(await screen.findByLabelText("Arquivo do extrato (CSV ou OFX)"), csvFile());
  await readPreview();
  await screen.findByText(/\d+ novas?/);
  await userEvent.click(importButton());
  await screen.findByText(/importados/);
  expect(api.state.previewCalls[0].accountId).toBe(wise.id);
  expect((api.confirms()[0].body as { account_id: string }).account_id).toBe(wise.id);
});

it("uma repetida marcada a mao e enviada", async () => {
  const api = await openPreview();
  await userEvent.click(screen.getByRole("checkbox", { name: "Importar a linha 4" }));
  await userEvent.click(importButton());
  await screen.findByText(/importados/);
  const sent = (api.confirms()[0].body as { rows: { description: string }[] }).rows.map((row) => row.description);
  expect(sent).toEqual(["Mercado Bom Preco", "Salario", "Padaria"]);
});

it("o resultado tem os dois caminhos: ver os lancamentos ou importar outro extrato", async () => {
  await openPreview();
  await userEvent.click(importButton());
  await screen.findByText(/importados/);
  expect(screen.getByRole("link", { name: "Ver lançamentos" })).toHaveAttribute("href", "/transacoes");
  await userEvent.click(screen.getByRole("button", { name: "Importar outro extrato" }));
  expect(await screen.findByRole("button", { name: "Ver prévia" })).toBeInTheDocument();
  expect(screen.queryByText(/extrato\.csv/)).not.toBeInTheDocument();
  // A conta continua escolhida (quem importa um extrato costuma importar o proximo na mesma conta); o arquivo nao
  expect((screen.getByLabelText("Conta que recebe o extrato") as HTMLSelectElement).value).toBe(nubank.id);
});

it("diz quantos ficaram de fora porque o banco ja tinha enviado, no singular e no plural", async () => {
  const api = await openPreview();
  api.state.skipOnConfirm = 1;
  await userEvent.click(importButton());
  expect(await screen.findByText("1 lançamento foi deixado de fora porque o banco já tinha enviado esse antes.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "1 lançamento importados" })).toBeInTheDocument();
});

it("plural dos deixados de fora", async () => {
  const api = renderPage([makePreview([makeRow({ index: 2 }), makeRow({ index: 3 }), makeRow({ index: 4 }), makeRow({ index: 5 })])]);
  api.state.skipOnConfirm = 2;
  await pickAccountAndFile();
  await readPreview();
  await screen.findByText(/\d+ novas?/);
  await userEvent.click(importButton());
  expect(await screen.findByText("2 lançamentos foram deixados de fora porque o banco já tinha enviado esses antes.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "2 lançamentos importados" })).toBeInTheDocument();
});

it("nada criado mostra 'Nada foi importado'", async () => {
  const api = await openPreview();
  api.state.skipOnConfirm = 2;
  await userEvent.click(importButton());
  expect(await screen.findByRole("heading", { name: "Nada foi importado" })).toBeInTheDocument();
});

it("falha ao confirmar mostra o erro, continua na previa e guarda as marcacoes", async () => {
  const api = await openPreview();
  await userEvent.click(screen.getByRole("checkbox", { name: "Importar a linha 2" }));
  api.state.nextConfirmError = { status: 400, code: "invalid_amount" };
  await userEvent.click(importButton());
  expect(await screen.findByRole("alert")).toHaveTextContent("Valor inválido para esta moeda.");
  expect(screen.getByRole("checkbox", { name: "Importar a linha 2" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Importar a linha 3" })).toBeChecked();
  expect(screen.queryByText(/importados/)).not.toBeInTheDocument();
});

it("voltar da previa recomeca do primeiro passo", async () => {
  await openPreview();
  await userEvent.click(screen.getByRole("button", { name: "Escolher outro arquivo" }));
  expect(await screen.findByRole("button", { name: "Ver prévia" })).toBeInTheDocument();
});

// ---------- OFX ----------

it("OFX nao tem passo de colunas nem botao de ajustar", async () => {
  renderPage([makeOfxPreview([makeRow({ index: 1, external_id: "F1" })])]);
  expect(screen.queryByText(/Colunas/)).not.toBeInTheDocument();
  await pickAccountAndFile("Nubank", new File(["OFXHEADER"], "extrato.ofx"));
  await readPreview();
  await screen.findByText(/\d+ novas?/);
  expect(screen.queryByRole("button", { name: "Ajustar colunas" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Colunas/)).not.toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Passos da importação" })).toHaveTextContent("1. Arquivo2. Prévia3. Pronto");
});

// ---------- Passo 2: colunas ----------

async function openMapping(previews = [makeNeedsMapping(), makePreview(sampleRows())]) {
  const api = renderPage(previews);
  await pickAccountAndFile();
  await readPreview();
  await screen.findByText(/Não deu para descobrir sozinho/);
  return api;
}

// Os tres campos de coluna tem as mesmas opcoes: a busca e sempre dentro do campo escolhido
const choose = (label: string, option: string) => {
  const select = screen.getByLabelText(label);
  return userEvent.selectOptions(select, within(select).getByRole("option", { name: new RegExp(`^${option}`) }));
};

it("sem como adivinhar as colunas mostra a amostra do arquivo e pede as colunas", async () => {
  await openMapping();
  const table = screen.getByRole("table", { name: "Primeiras linhas do arquivo" });
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "1. Dia",
    "2. Texto",
    "3. Entrada",
    "4. Saida",
    "5. Saldo",
  ]);
  expect(within(table).getByText("Mercado")).toBeInTheDocument();
  expect(within(table).getByText("1000,00")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Passos da importação" })).toHaveTextContent("1. Arquivo2. Colunas3. Prévia4. Pronto");
  expect(screen.getByLabelText("A primeira linha do arquivo é o cabeçalho (os nomes das colunas)")).toBeChecked();
});

it("enviar sem escolher nada mostra um aviso em cada coluna e nao chama a API de novo", async () => {
  const api = await openMapping();
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  expect(screen.getByText("Escolha a coluna da data.")).toBeInTheDocument();
  expect(screen.getByText("Escolha a coluna da descrição.")).toBeInTheDocument();
  expect(screen.getByText("Escolha a coluna do valor.")).toBeInTheDocument();
  expect(api.state.previewCalls).toHaveLength(1);
});

it("escolhidas as colunas, envia o mapeamento e mostra a previa", async () => {
  const api = await openMapping();
  await choose("Coluna da data", "1\\. Dia");
  await choose("Coluna da descrição", "2\\. Texto");
  await choose("Coluna do valor", "5\\. Saldo");
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  await screen.findByText(/\d+ novas?/);
  expect(api.state.previewCalls).toHaveLength(2);
  expect(api.state.previewCalls[1]).toMatchObject({
    accountId: nubank.id,
    mapping: { date_column: 0, description_column: 1, amount_column: 4, has_header: true },
  });
});

it("debito e credito: troca os campos e envia as duas colunas, sem a coluna unica", async () => {
  const api = await openMapping();
  await userEvent.click(screen.getByRole("radio", { name: "Duas colunas: débito (saída) e crédito (entrada)" }));
  expect(screen.queryByLabelText("Coluna do valor")).not.toBeInTheDocument();
  await choose("Coluna da data", "1\\. Dia");
  await choose("Coluna da descrição", "2\\. Texto");
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  expect(screen.getByText("Escolha a coluna de débito.")).toBeInTheDocument();
  expect(screen.getByText("Escolha a coluna de crédito.")).toBeInTheDocument();
  await choose("Coluna de débito", "4\\. Saida");
  await choose("Coluna de crédito", "3\\. Entrada");
  expect(screen.queryByText("Escolha a coluna de débito.")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  await screen.findByText(/\d+ novas?/);
  expect(api.state.previewCalls[1].mapping).toEqual({ date_column: 0, description_column: 1, debit_column: 3, credit_column: 2, has_header: true });
});

it("a mesma coluna para duas informacoes e recusada", async () => {
  const api = await openMapping();
  await choose("Coluna da data", "1\\. Dia");
  await choose("Coluna da descrição", "1\\. Dia");
  await choose("Coluna do valor", "3\\. Entrada");
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  expect(screen.getByText("Cada informação precisa de uma coluna diferente.")).toBeInTheDocument();
  expect(api.state.previewCalls).toHaveLength(1);
});

it("o aviso de uma coluna some quando a pessoa a escolhe", async () => {
  await openMapping();
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  await choose("Coluna da data", "1\\. Dia");
  expect(screen.queryByText("Escolha a coluna da data.")).not.toBeInTheDocument();
  expect(screen.getByText("Escolha a coluna da descrição.")).toBeInTheDocument();
});

it("sem cabecalho: a primeira linha desce para a amostra, as colunas ganham nome generico e o envio diz has_header falso", async () => {
  const api = await openMapping();
  await userEvent.click(screen.getByLabelText("A primeira linha do arquivo é o cabeçalho (os nomes das colunas)"));
  const table = screen.getByRole("table", { name: "Primeiras linhas do arquivo" });
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "1. Coluna 1",
    "2. Coluna 2",
    "3. Coluna 3",
    "4. Coluna 4",
    "5. Coluna 5",
  ]);
  // O que era cabecalho agora e a primeira linha de dados
  expect(within(table).getByText("Dia")).toBeInTheDocument();
  await choose("Coluna da data", "1\\. Coluna 1");
  await choose("Coluna da descrição", "2\\. Coluna 2");
  await choose("Coluna do valor", "3\\. Coluna 3");
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  await screen.findByText(/\d+ novas?/);
  expect(api.state.previewCalls[1].mapping).toMatchObject({ has_header: false });
});

it("trocar o cabecalho limpa os avisos antigos", async () => {
  await openMapping();
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  expect(screen.getByText("Escolha a coluna da data.")).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("A primeira linha do arquivo é o cabeçalho (os nomes das colunas)"));
  expect(screen.queryByText("Escolha a coluna da data.")).not.toBeInTheDocument();
});

it("trocar o modo do valor limpa os avisos do valor", async () => {
  await openMapping();
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  expect(screen.getByText("Escolha a coluna do valor.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "Duas colunas: débito (saída) e crédito (entrada)" }));
  expect(screen.queryByText("Escolha a coluna do valor.")).not.toBeInTheDocument();
});

it("o servidor recusar as colunas mostra o motivo no passo das colunas", async () => {
  const api = await openMapping();
  api.state.nextPreviewError = { status: 422, code: "import_file_invalid", detail: "Uma das colunas escolhidas nao existe no arquivo" };
  await choose("Coluna da data", "1\\. Dia");
  await choose("Coluna da descrição", "2\\. Texto");
  await choose("Coluna do valor", "5\\. Saldo");
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível ler o arquivo: Uma das colunas escolhidas nao existe no arquivo");
  expect(screen.getByText(/Não deu para descobrir sozinho/)).toBeInTheDocument();
});

it("voltar do passo das colunas recomeca", async () => {
  await openMapping();
  await userEvent.click(screen.getByRole("button", { name: "Voltar" }));
  expect(await screen.findByRole("button", { name: "Ver prévia" })).toBeInTheDocument();
  expect(screen.getByLabelText("Conta que recebe o extrato")).toBeInTheDocument();
});

it("mostra que esta lendo no passo das colunas", async () => {
  const api = await openMapping();
  await choose("Coluna da data", "1\\. Dia");
  await choose("Coluna da descrição", "2\\. Texto");
  await choose("Coluna do valor", "5\\. Saldo");
  api.state.holdPreview = true;
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  expect(await screen.findByRole("button", { name: "Lendo o arquivo..." })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Voltar" })).toBeDisabled();
  api.state.release?.();
  await screen.findByText(/\d+ novas?/);
});

// ---------- Ajustar colunas depois da previa ----------

it("ajustar colunas reabre o passo com o que o servidor adivinhou ja escolhido", async () => {
  const api = renderPage([makePreview(sampleRows())]);
  await pickAccountAndFile();
  await readPreview();
  await screen.findByText(/\d+ novas?/);
  await userEvent.click(screen.getByRole("button", { name: "Ajustar colunas" }));
  expect((screen.getByLabelText("Coluna da data") as HTMLSelectElement).value).toBe("0");
  expect((screen.getByLabelText("Coluna da descrição") as HTMLSelectElement).value).toBe("1");
  expect((screen.getByLabelText("Coluna do valor") as HTMLSelectElement).value).toBe("2");
  expect(screen.getByLabelText("A primeira linha do arquivo é o cabeçalho (os nomes das colunas)")).toBeChecked();

  // Mudar uma coluna e pedir de novo reenvia o mesmo arquivo com o novo mapeamento
  await choose("Coluna do valor", "3\\. Valor");
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  await screen.findByText(/\d+ novas?/);
  expect(api.state.previewCalls).toHaveLength(2);
  expect(api.state.previewCalls[1].mapping).toMatchObject({ amount_column: 2, has_header: true });
});

it("depois de ajustar as colunas as marcacoes voltam ao padrao (so as novas)", async () => {
  renderPage([makePreview(sampleRows()), makePreview(sampleRows())]);
  await pickAccountAndFile();
  await readPreview();
  await screen.findByText(/\d+ novas?/);
  await userEvent.click(screen.getByRole("checkbox", { name: "Importar a linha 4" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Importar a linha 2" }));
  await userEvent.click(screen.getByRole("button", { name: "Ajustar colunas" }));
  await userEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
  await screen.findByText(/\d+ novas?/);
  expect(screen.getByRole("checkbox", { name: "Importar a linha 2" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Importar a linha 4" })).not.toBeChecked();
});

it("a previa do CSV mostra os passos com Colunas", async () => {
  await openPreview();
  expect(screen.getByRole("list", { name: "Passos da importação" })).toHaveTextContent("1. Arquivo2. Colunas3. Prévia4. Pronto");
  expect(screen.getByText("3. Prévia")).toHaveAttribute("aria-current", "step");
});

// ---------- Carregamento das contas ----------

it("falha ao carregar as contas permite tentar de novo", async () => {
  const accountsApi = fakeAccountsApi([nubank]);
  accountsApi.state.listError = true;
  server.use(...accountsApi.handlers);
  render(
    <FakeAuth>
      <MemoryRouter>
        <ImportPage />
      </MemoryRouter>
    </FakeAuth>,
  );
  expect(await screen.findByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("Carregando contas...")).not.toBeInTheDocument());
});
