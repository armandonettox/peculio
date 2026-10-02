import { Plus, Webhook as WebhookIcon } from "lucide-react";
import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import {
  useDeleteWebhook,
  useRotateWebhookSecret,
  useTestWebhook,
  useUpdateWebhook,
  useWebhooks,
  type Webhook,
  type WebhookDelivery,
} from "@/api/webhooks";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DeliveriesDialog } from "@/features/webhooks/deliveries-dialog";
import { RotateSecretDialog } from "@/features/webhooks/rotate-secret-dialog";
import { SecretDialog } from "@/features/webhooks/secret-dialog";
import { TestResultDialog } from "@/features/webhooks/test-result-dialog";
import { WebhookCard } from "@/features/webhooks/webhook-card";
import { WebhookFormDialog } from "@/features/webhooks/webhook-form-dialog";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; webhook: Webhook }
  | { kind: "delete"; webhook: Webhook }
  | { kind: "rotate"; webhook: Webhook }
  | { kind: "history"; webhook: Webhook }
  | { kind: "test"; webhook: Webhook; result: WebhookDelivery | null; error: string | null }
  | { kind: "secret"; webhookName: string; secret: string }
  | null;

export default function WebhooksPage() {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useWebhooks();
  const update = useUpdateWebhook();
  const remove = useDeleteWebhook();
  const rotate = useRotateWebhookSecret();
  const test = useTestWebhook();
  const items = query.data ?? [];

  async function togglePause(webhook: Webhook) {
    setActionError(null);
    try {
      await update.mutateAsync({ id: webhook.id, body: { active: !webhook.active } });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  async function runTest(webhook: Webhook) {
    setActionError(null);
    setDialog({ kind: "test", webhook, result: null, error: null });
    // So atualiza o dialogo se ele ainda for o deste teste (a pessoa pode ter fechado)
    const sameTest = (current: DialogState) =>
      current?.kind === "test" && current.webhook.id === webhook.id ? current : null;
    try {
      const result = await test.mutateAsync(webhook.id);
      setDialog((current) => (sameTest(current) ? { kind: "test", webhook, result, error: null } : current));
    } catch (error) {
      const message = getErrorMessage(error);
      setDialog((current) => (sameTest(current) ? { kind: "test", webhook, result: null, error: message } : current));
    }
  }

  const newButton = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <Plus />
      Novo webhook
    </Button>
  );

  let content;
  if (query.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-3">
        {[0, 1].map((index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          Carregando webhooks...
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
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={WebhookIcon}
        title="Nenhum webhook ainda"
        description="Um webhook avisa outro sistema, como uma planilha ou uma automação, sempre que um lançamento é criado, editado ou excluído."
        action={newButton}
      />
    );
  } else {
    content = (
      <ul className="flex flex-col gap-3">
        {items.map((webhook) => (
          <WebhookCard
            key={webhook.id}
            webhook={webhook}
            onEdit={(item) => setDialog({ kind: "edit", webhook: item })}
            onTest={(item) => void runTest(item)}
            onRotateSecret={(item) => setDialog({ kind: "rotate", webhook: item })}
            onHistory={(item) => setDialog({ kind: "history", webhook: item })}
            onTogglePause={(item) => void togglePause(item)}
            onDelete={(item) => setDialog({ kind: "delete", webhook: item })}
          />
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader title="Webhooks" description="Avisos automáticos para outros sistemas" actions={newButton} />

      {actionError && (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      )}

      {content}

      {dialog?.kind === "create" && (
        <WebhookFormDialog
          onClose={() => setDialog(null)}
          onCreated={(created) => setDialog({ kind: "secret", webhookName: created.name, secret: created.secret })}
        />
      )}
      {dialog?.kind === "edit" && <WebhookFormDialog webhook={dialog.webhook} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title="Excluir webhook"
          itemName={dialog.webhook.name}
          consequence="O histórico de entregas dele também é apagado e os avisos pendentes não são enviados."
          onConfirm={() => remove.mutateAsync(dialog.webhook.id)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rotate" && (
        <RotateSecretDialog
          webhookName={dialog.webhook.name}
          onConfirm={async () => {
            const rotated = await rotate.mutateAsync(dialog.webhook.id);
            // Troca direto para o dialogo do segredo novo, que aparece uma unica vez
            setDialog({ kind: "secret", webhookName: rotated.name, secret: rotated.secret });
          }}
          onClose={() => setDialog((current) => (current?.kind === "rotate" ? null : current))}
        />
      )}
      {dialog?.kind === "history" && <DeliveriesDialog webhook={dialog.webhook} onClose={() => setDialog(null)} />}
      {dialog?.kind === "test" && (
        <TestResultDialog
          webhookName={dialog.webhook.name}
          result={dialog.result}
          error={dialog.error}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "secret" && (
        <SecretDialog webhookName={dialog.webhookName} secret={dialog.secret} onDone={() => setDialog(null)} />
      )}
    </>
  );
}
