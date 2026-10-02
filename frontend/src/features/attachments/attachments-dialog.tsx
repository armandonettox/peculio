import { Download, FileText, Paperclip, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import {
  ATTACHMENT_ACCEPT,
  downloadAttachment,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
  type Attachment,
} from "@/api/attachments";
import { getErrorMessage } from "@/api/error-messages";
import type { Transaction } from "@/api/transactions";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { transactionTitle } from "@/features/transactions/presentation";
import { formatBytes, formatUploadDate } from "./format";

type Props = {
  transaction: Transaction;
  onClose: () => void;
};

/** Anexos de um lancamento: lista, envia, baixa e exclui. */
export function AttachmentsDialog({ transaction, onClose }: Props) {
  const query = useAttachments(transaction.id);
  const upload = useUploadAttachment(transaction.id);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const remove = useDeleteAttachment();
  // Erro do envio ou do download, mostrado em cima da lista
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const attachments = query.data ?? [];
  const full = attachments.length >= MAX_ATTACHMENTS_PER_TRANSACTION;

  async function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    // Limpa o campo: escolher o mesmo arquivo de novo (depois de um erro) precisa disparar o evento
    input.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(`O arquivo "${file.name}" passa do limite de 10 MB.`);
      return;
    }
    try {
      await upload.mutateAsync(file);
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  async function download(attachment: Attachment) {
    setError(null);
    setDownloadingId(attachment.id);
    try {
      await downloadAttachment(attachment);
    } catch (failure) {
      setError(getErrorMessage(failure));
    } finally {
      setDownloadingId(null);
    }
  }

  let content;
  if (query.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-2">
        {[0, 1].map((index) => (
          <div key={index} className="h-14 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          Carregando anexos...
        </p>
      </div>
    );
  } else if (query.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(query.error)}
        </Alert>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  } else if (attachments.length === 0) {
    content = (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nenhum anexo ainda. Guarde aqui o comprovante, a nota fiscal ou uma foto do recibo.
      </p>
    );
  } else {
    content = (
      <ul className="flex flex-col gap-2" aria-label="Anexos do lançamento">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{attachment.original_name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(attachment.size_bytes)} · {formatUploadDate(attachment.created_at)}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label={`Baixar ${attachment.original_name}`}
                disabled={downloadingId === attachment.id}
                onClick={() => void download(attachment)}
              >
                <Download />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={`Excluir ${attachment.original_name}`}
                onClick={() => setRemoving(attachment)}
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !upload.isPending && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anexos</DialogTitle>
            <DialogDescription>
              {transactionTitle(transaction)}. PDF, imagem (JPEG, PNG, WEBP), TXT ou CSV, até 10 MB cada e 10
              por lançamento.
            </DialogDescription>
          </DialogHeader>

          {error && <Alert variant="destructive">{error}</Alert>}

          {content}

          <div className="flex flex-col items-start gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              aria-label="Escolher arquivo"
              tabIndex={-1}
              className="sr-only"
              onChange={(event) => void onFileChosen(event)}
            />
            <Button disabled={upload.isPending || full || query.isPending} onClick={() => inputRef.current?.click()}>
              <Paperclip />
              {upload.isPending ? "Enviando..." : "Adicionar arquivo"}
            </Button>
            {full && (
              <p className="text-xs text-muted-foreground">
                Este lançamento já tem {MAX_ATTACHMENTS_PER_TRANSACTION} anexos. Exclua um para enviar outro.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {removing && (
        <ConfirmDeleteDialog
          title="Excluir anexo"
          itemName={removing.original_name}
          consequence="O arquivo é apagado do servidor."
          onConfirm={() => remove.mutateAsync(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}
