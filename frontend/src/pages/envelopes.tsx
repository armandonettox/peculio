import { ChevronLeft, ChevronRight, Mail, Plus } from "lucide-react";
import { useState } from "react";

import { useBills } from "@/api/bills";
import { useDeleteBudget, type Budget } from "@/api/budgets";
import { getErrorMessage } from "@/api/error-messages";
import { useEnvelopes, type Envelope } from "@/api/envelopes";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BudgetFormDialog } from "@/features/budgets/budget-form-dialog";
import { EnvelopeGroupTable, type EnvelopeAction } from "@/features/envelopes/envelope-group-table";
import { ApplyTemplatesDialog } from "@/features/envelopes/apply-templates-dialog";
import { MoveMoneyDialog } from "@/features/envelopes/move-money-dialog";
import { TemplateDialog } from "@/features/envelopes/template-dialog";
import { appToday, firstOfMonth, formatMonthYear, shiftMonth } from "@/lib/dates";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; envelope: Envelope }
  | { kind: "template"; envelope: Envelope; currency: string }
  | { kind: "apply" }
  | { kind: "delete"; envelope: Envelope }
  | { kind: "move"; currency: string; to?: string }
  | null;

export default function EnvelopesPage() {
  const currentMonth = firstOfMonth(appToday());
  const [month, setMonth] = useState(currentMonth);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useEnvelopes(month);
  const remove = useDeleteBudget();
  const groups = query.data?.groups ?? [];
  const bills = useBills({ activeOnly: false });
  const billNames = Object.fromEntries((bills.data ?? []).map((bill) => [bill.id, bill.name]));

  function handleAction(action: EnvelopeAction, envelope: Envelope, currency: string) {
    if (action === "template") setDialog({ kind: "template", envelope, currency });
    else setDialog({ kind: action, envelope });
  }

  const newButton = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <Plus />
      Novo envelope
    </Button>
  );

  let content;
  if (query.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-3">
        <div className="h-24 animate-pulse rounded-lg border bg-muted" />
        <div className="h-40 animate-pulse rounded-lg border bg-muted" />
        <p className="sr-only" role="status">
          Carregando envelopes...
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
  } else if (groups.length === 0) {
    content = (
      <EmptyState
        icon={Mail}
        title="Nenhum envelope ainda"
        description="No envelope você distribui o dinheiro que já tem, mês a mês. O que sobra passa para o mês seguinte; o que estoura sai do que ainda falta orçar."
        action={newButton}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <div key={group.currency_code} className="flex flex-col gap-3">
            <EnvelopeGroupTable
              month={month}
              group={group}
              onAction={(action, envelope) => handleAction(action, envelope, group.currency_code)}
              billNames={billNames}
              onError={setActionError}
              onCover={(envelope) => setDialog({ kind: "move", currency: group.currency_code, to: envelope.budget_id })}
            />
            {group.envelopes.length > 1 && (
              <div>
                <Button variant="outline" onClick={() => setDialog({ kind: "move", currency: group.currency_code })}>
                  Mover dinheiro
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  const movingGroup = dialog?.kind === "move" ? groups.find((group) => group.currency_code === dialog.currency) : undefined;

  return (
    <>
      <PageHeader title="Envelopes" description="Distribua o dinheiro que você tem, mês a mês" actions={newButton} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" className="shrink-0" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft />
        </Button>
        <p className="min-w-36 text-center text-sm font-medium first-letter:uppercase" aria-live="polite">
          {formatMonthYear(month)}
        </p>
        <Button variant="outline" size="icon" className="shrink-0" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight />
        </Button>
        {month !== currentMonth && (
          <Button variant="ghost" size="sm" onClick={() => setMonth(currentMonth)}>
            Mês atual
          </Button>
        )}
        {groups.length > 0 && (
          <Button variant="outline" className="sm:ml-auto" onClick={() => setDialog({ kind: "apply" })}>
            Aplicar templates
          </Button>
        )}
      </div>

      {actionError && (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      )}

      {content}

      {dialog?.kind === "create" && <BudgetFormDialog initialMode="envelope" onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && (
        <BudgetFormDialog budget={asBudget(dialog.envelope)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "template" && (
        <TemplateDialog envelope={dialog.envelope} currencyCode={dialog.currency} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "apply" && <ApplyTemplatesDialog month={month} onClose={() => setDialog(null)} />}
      {dialog?.kind === "move" && movingGroup && (
        <MoveMoneyDialog month={month} group={movingGroup} initialTo={dialog.to} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title="Excluir envelope"
          itemName={dialog.envelope.name}
          consequence="O que foi distribuído para ele some e volta para o A orçar. Os lançamentos ligados ficam sem envelope."
          onConfirm={() => remove.mutateAsync(dialog.envelope.budget_id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

// O formulario edita so o nome do envelope; o resto vem do modo
function asBudget(envelope: Envelope): Budget {
  return {
    id: envelope.budget_id,
    name: envelope.name,
    currency_code: "",
    mode: "envelope",
    amount: null,
    period: "monthly",
    active: true,
    created_at: "",
  };
}
