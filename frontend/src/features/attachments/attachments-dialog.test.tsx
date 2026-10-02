import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { tokenStore } from "@/auth/token-store";
import { fakeAttachmentsApi, makeAttachment } from "@/test-utils/attachments-api";
import { server } from "@/test-utils/msw";
import { FakeAuth } from "@/test-utils/providers";
import { makeTransaction } from "@/test-utils/transaction-fixtures";
import { AttachmentsDialog } from "./attachments-dialog";

const transaction = makeTransaction({}, [{ description: "Compra no mercado" }]);

function renderDialog(initial = [makeAttachment({ transaction_id: transaction.id })]) {
  const api = fakeAttachmentsApi(initial);
  server.use(...api.handlers);
  const onClose = vi.fn();
  render(
    <FakeAuth>
      <AttachmentsDialog transaction={transaction} onClose={onClose} />
    </FakeAuth>,
  );
  return { api, onClose };
}

const pdf = (name = "nota.pdf") => new File(["%PDF-1.4"], name, { type: "application/pdf" });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:http://localhost/arquivo-temporario");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- Estados ----------

it("mostra o carregamento e depois os arquivos com nome, tamanho e data", async () => {
  renderDialog([
    makeAttachment({
      transaction_id: transaction.id,
      original_name: "nota fiscal.pdf",
      size_bytes: 1536,
      created_at: "2026-03-10T15:00:00Z",
    }),
  ]);
  expect(screen.getByRole("status")).toHaveTextContent("Carregando anexos");

  const list = await screen.findByRole("list", { name: "Anexos do lançamento" });
  const item = within(list).getByText("nota fiscal.pdf").closest("li") as HTMLElement;
  expect(within(item).getByText(/1,5 KB · 10\/03\/2026/)).toBeInTheDocument();
});

it("mostra o estado vazio", async () => {
  renderDialog([]);
  expect(await screen.findByText(/Nenhum anexo ainda/)).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Anexos do lançamento" })).not.toBeInTheDocument();
});

it("erro ao carregar mostra a mensagem e Tentar de novo recarrega", async () => {
  const { api } = renderDialog();
  api.state.listError = true;
  expect(await screen.findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");

  api.state.listError = false;
  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("list", { name: "Anexos do lançamento" })).toBeInTheDocument();
});

// ---------- Envio ----------

it("envia o arquivo escolhido em multipart e mostra na lista", async () => {
  const { api } = renderDialog([]);
  api.state.uploadedName = "recibo.pdf";
  const append = vi.spyOn(FormData.prototype, "append");
  await screen.findByText(/Nenhum anexo ainda/);

  await userEvent.upload(screen.getByLabelText("Escolher arquivo"), pdf("recibo.pdf"));

  expect(await screen.findByText("recibo.pdf")).toBeInTheDocument();
  // O arquivo vai no campo "file" do formulario
  expect(append).toHaveBeenCalledWith("file", expect.objectContaining({ name: "recibo.pdf" }), "recibo.pdf");
  const [sent] = api.writes();
  expect(sent).toMatchObject({ method: "POST", path: `/transactions/${transaction.id}/attachments` });
  expect(sent.contentType).toMatch(/^multipart\/form-data; boundary=/);
});

it("o botao fica desabilitado enquanto envia", async () => {
  const { api } = renderDialog([]);
  api.state.holdUpload = true;
  await screen.findByText(/Nenhum anexo ainda/);

  await userEvent.upload(screen.getByLabelText("Escolher arquivo"), pdf());

  const button = await screen.findByRole("button", { name: "Enviando..." });
  expect(button).toBeDisabled();

  api.state.release?.();
  expect(await screen.findByRole("button", { name: "Adicionar arquivo" })).toBeEnabled();
});

it("arquivo acima de 10 MB e recusado no navegador, sem chamar o servidor", async () => {
  const { api } = renderDialog([]);
  await screen.findByText(/Nenhum anexo ainda/);
  const big = pdf("enorme.pdf");
  Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });

  await userEvent.upload(screen.getByLabelText("Escolher arquivo"), big);

  expect(await screen.findByRole("alert")).toHaveTextContent('O arquivo "enorme.pdf" passa do limite de 10 MB.');
  expect(api.writes()).toHaveLength(0);
});

it("arquivo de exatamente 10 MB passa pela checagem do navegador", async () => {
  const { api } = renderDialog([]);
  await screen.findByText(/Nenhum anexo ainda/);
  const exact = pdf("limite.pdf");
  Object.defineProperty(exact, "size", { value: 10 * 1024 * 1024 });

  await userEvent.upload(screen.getByLabelText("Escolher arquivo"), exact);

  await waitFor(() => expect(api.writes()).toHaveLength(1));
});

it("mostra o erro do servidor traduzido e deixa tentar de novo", async () => {
  const { api } = renderDialog([]);
  await screen.findByText(/Nenhum anexo ainda/);
  api.state.uploadedName = "estranho.pdf";
  api.state.nextUploadError = { status: 415, code: "attachment_type_not_allowed" };

  await userEvent.upload(screen.getByLabelText("Escolher arquivo"), pdf("estranho.pdf"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Tipo de arquivo não permitido");
  expect(screen.getByRole("button", { name: "Adicionar arquivo" })).toBeEnabled();

  await userEvent.upload(screen.getByLabelText("Escolher arquivo"), pdf("estranho.pdf"));
  expect(await screen.findByText("estranho.pdf")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("com 10 anexos o botao fica desabilitado e explica o motivo", async () => {
  const ten = Array.from({ length: 10 }, () => makeAttachment({ transaction_id: transaction.id }));
  renderDialog(ten);
  await screen.findByRole("list", { name: "Anexos do lançamento" });
  expect(screen.getByRole("button", { name: "Adicionar arquivo" })).toBeDisabled();
  expect(screen.getByText(/já tem 10 anexos/)).toBeInTheDocument();
});

// ---------- Download ----------

it("baixa o arquivo com o token no cabecalho e nunca na URL", async () => {
  tokenStore.set("token-secreto-123");
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const attachment = makeAttachment({ transaction_id: transaction.id, original_name: "nota fiscal.pdf" });
  const { api } = renderDialog([attachment]);

  await userEvent.click(await screen.findByRole("button", { name: "Baixar nota fiscal.pdf" }));

  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  const download = api.state.requests.find((request) => request.path.endsWith("/download"));
  expect(download?.authorization).toBe("Bearer token-secreto-123");
  expect(download?.path).not.toContain("token");
  expect(download?.path).toBe(`/attachments/${attachment.id}/download`);

  // Usa uma URL temporaria do navegador, com o nome certo, e depois a revoga
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  const link = click.mock.contexts[0] as HTMLAnchorElement;
  expect(link.download).toBe("nota fiscal.pdf");
  expect(link.href).toBe("blob:http://localhost/arquivo-temporario");
  expect(link.href).not.toContain("token");
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/arquivo-temporario"));
});

it("erro ao baixar mostra a mensagem traduzida", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const attachment = makeAttachment({ transaction_id: transaction.id, original_name: "sumiu.pdf" });
  const { api } = renderDialog([attachment]);
  api.state.nextDownloadError = { status: 404, code: "attachment_not_found" };

  await userEvent.click(await screen.findByRole("button", { name: "Baixar sumiu.pdf" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Anexo não encontrado.");
  expect(click).not.toHaveBeenCalled();
});

// ---------- Exclusao ----------

it("excluir pede confirmacao e so apaga depois dela", async () => {
  const attachment = makeAttachment({ transaction_id: transaction.id, original_name: "velho.pdf" });
  const { api } = renderDialog([attachment]);

  await userEvent.click(await screen.findByRole("button", { name: "Excluir velho.pdf" }));
  const confirm = await screen.findByRole("dialog", { name: "Excluir anexo" });
  expect(within(confirm).getByText("velho.pdf")).toBeInTheDocument();
  expect(api.writes()).toHaveLength(0);

  await userEvent.click(within(confirm).getByRole("button", { name: "Cancelar" }));
  expect(api.writes()).toHaveLength(0);
  expect(screen.getByText("velho.pdf")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Excluir velho.pdf" }));
  await userEvent.click(within(await screen.findByRole("dialog", { name: "Excluir anexo" })).getByRole("button", { name: "Excluir" }));

  await waitFor(() => expect(screen.queryByText("velho.pdf")).not.toBeInTheDocument());
  expect(api.writes()).toEqual([expect.objectContaining({ method: "DELETE", path: `/attachments/${attachment.id}` })]);
  expect(await screen.findByText(/Nenhum anexo ainda/)).toBeInTheDocument();
});

it("erro ao excluir fica na confirmacao e o arquivo continua na lista", async () => {
  const attachment = makeAttachment({ transaction_id: transaction.id, original_name: "fica.pdf" });
  const { api } = renderDialog([attachment]);
  api.state.nextDeleteError = { status: 500, code: "internal_error" };

  await userEvent.click(await screen.findByRole("button", { name: "Excluir fica.pdf" }));
  const confirm = await screen.findByRole("dialog", { name: "Excluir anexo" });
  await userEvent.click(within(confirm).getByRole("button", { name: "Excluir" }));

  expect(await within(confirm).findByRole("alert")).toHaveTextContent("Algo deu errado do nosso lado");
  expect(within(screen.getByRole("list", { name: "Anexos do lançamento", hidden: true })).getByText("fica.pdf")).toBeInTheDocument();
});
