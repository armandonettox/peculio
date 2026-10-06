import { Coins, Plus } from "lucide-react";
import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { useDeletePiggyBank, usePiggyBanks, useUpdatePiggyBank, type PiggyBank } from "@/api/piggy-banks";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PiggyBankCard, type PiggyAction } from "@/features/piggy-banks/piggy-bank-card";
import { PiggyBankFormDialog } from "@/features/piggy-banks/piggy-bank-form-dialog";
import { PiggyBankHistoryDialog } from "@/features/piggy-banks/piggy-bank-history-dialog";
import { PiggyBankMoneyDialog } from "@/features/piggy-banks/piggy-bank-money-dialog";
import { appToday } from "@/lib/dates";
import { useTranslation } from "react-i18next";

type DialogState = { kind: "create" } | { kind: Exclude<PiggyAction, "archive">; piggy: PiggyBank } | null;

export default function PiggyBanksPage() {
  const { t } = useTranslation();
  const today = appToday();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const query = usePiggyBanks({ includeArchived });
  const remove = useDeletePiggyBank();
  const archive = useUpdatePiggyBank();
  const items = query.data ?? [];

  async function handleAction(action: PiggyAction, piggy: PiggyBank) {
    if (action !== "archive") {
      setDialog({ kind: action, piggy });
      return;
    }
    setActionError(null);
    try {
      await archive.mutateAsync({ id: piggy.id, body: { active: !piggy.active } });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  const newButton = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <Plus />
      {t("pages.piggyBanks.novoCofrinho")}
    </Button>
  );

  let content;
  if (query.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-3">
        {[0, 1].map((index) => (
          <div key={index} className="h-32 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          {t("pages.piggyBanks.carregandoCofrinhos")}
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
        icon={Coins}
        title={t("pages.piggyBanks.nenhumCofrinhoAinda")}
        description={t("pages.piggyBanks.separeUmValorDe")}
        action={newButton}
      />
    );
  } else {
    content = (
      <>
        <h2 className="sr-only">{t("pages.piggyBanks.seusCofrinhos")}</h2>
        <ul className="flex flex-col gap-3">
        {items.map((piggy) => (
          <PiggyBankCard
            key={piggy.id}
            piggy={piggy}
            today={today}
            onAction={(action, item) => void handleAction(action, item)}
          />
        ))}
      </ul>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("pages.piggyBanks.cofrinhos")} description={t("pages.piggyBanks.metasGuardadasDentroDas")} actions={newButton} />

      <div className="mb-4 flex justify-end">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            className="accent-[var(--primary)]"
          />
          {t("pages.piggyBanks.mostrarArquivados")}
        </label>
      </div>

      {actionError && (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      )}

      {content}

      {dialog?.kind === "create" && <PiggyBankFormDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <PiggyBankFormDialog piggy={dialog.piggy} onClose={() => setDialog(null)} />}
      {(dialog?.kind === "add" || dialog?.kind === "remove") && (
        <PiggyBankMoneyDialog piggy={dialog.piggy} kind={dialog.kind} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "history" && <PiggyBankHistoryDialog piggy={dialog.piggy} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title={t("pages.piggyBanks.excluirCofrinho")}
          itemName={dialog.piggy.name}
          consequence={t("pages.piggyBanks.oValorGuardadoVolta")}
          onConfirm={() => remove.mutateAsync(dialog.piggy.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
