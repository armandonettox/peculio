import { Plus, Receipt } from "lucide-react";
import { useState } from "react";

import { useBillsStatus, useDeleteBill, useUpdateBill, type BillStatus } from "@/api/bills";
import { getErrorMessage } from "@/api/error-messages";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BillCard } from "@/features/bills/bill-card";
import { BillFormDialog } from "@/features/bills/bill-form-dialog";
import { appToday } from "@/lib/dates";
import { useTranslation } from "react-i18next";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; bill: BillStatus }
  | { kind: "delete"; bill: BillStatus }
  | null;

export default function BillsPage() {
  const { t } = useTranslation();
  const today = appToday();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useBillsStatus({ on: today, includeArchived });
  const update = useUpdateBill();
  const remove = useDeleteBill();
  const items = query.data ?? [];

  async function toggleArchive(bill: BillStatus) {
    setActionError(null);
    try {
      await update.mutateAsync({ id: bill.id, body: { active: !bill.active } });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  const newButton = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <Plus />
      {t("pages.bills.novaContaAPagar")}
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
          {t("pages.bills.carregandoContasAPagar")}
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
          {t("common.tentarDeNovo")}
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={Receipt}
        title={t("pages.bills.nenhumaContaAPagar")}
        description={t("pages.bills.cadastreOQueVence")}
        action={newButton}
      />
    );
  } else {
    content = (
      <>
        <h2 className="sr-only">{t("pages.bills.suasContasAPagar")}</h2>
        <ul className="flex flex-col gap-3">
        {items.map((bill) => (
          <BillCard
            key={bill.id}
            bill={bill}
            today={today}
            onEdit={(item) => setDialog({ kind: "edit", bill: item })}
            onToggleArchive={(item) => void toggleArchive(item)}
            onDelete={(item) => setDialog({ kind: "delete", bill: item })}
          />
        ))}
      </ul>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("pages.bills.contasAPagar")} description={t("pages.bills.oQueVenceSempre")} actions={newButton} />

      <div className="mb-4 flex justify-end">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            className="accent-[var(--primary)]"
          />
          {t("pages.bills.mostrarArquivadas")}
        </label>
      </div>

      {actionError && (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      )}

      {content}

      {dialog?.kind === "create" && <BillFormDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <BillFormDialog bill={dialog.bill} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title={t("pages.bills.excluirContaAPagar")}
          itemName={dialog.bill.name}
          consequence={t("pages.bills.osLancamentosLigadosA")}
          onConfirm={() => remove.mutateAsync(dialog.bill.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
