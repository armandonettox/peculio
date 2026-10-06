import { Landmark, Plus } from "lucide-react";
import { useState } from "react";

import { useAccounts, useCurrencies, useUpdateAccount, type Account } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AccountCard } from "@/features/accounts/account-card";
import { AccountFormDialog } from "@/features/accounts/account-form-dialog";
import { DeleteAccountDialog } from "@/features/accounts/delete-account-dialog";
import { totalsByCurrency } from "@/features/accounts/totals";
import { formatMoney, negateMoney } from "@/lib/money";

type DialogState = { kind: "create" } | { kind: "edit"; account: Account } | { kind: "delete"; account: Account } | null;

function Totals({ label, totals }: { label: string; totals: { currency: string; total: string }[] }) {
  if (totals.length === 0) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {label}:{" "}
      {totals.map((item, index) => (
        <span key={item.currency}>
          {index > 0 && " · "}
          <span className="font-medium text-foreground">{formatMoney(item.total, item.currency)}</span>
        </span>
      ))}
    </p>
  );
}

export default function AccountsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const accounts = useAccounts({ includeArchived: showArchived });
  const currencies = useCurrencies();
  const update = useUpdateAccount();

  const places = Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places]));
  const items = accounts.data ?? [];
  const assets = items.filter((account) => account.type === "asset");
  const liabilities = items.filter((account) => account.type === "liability");

  async function toggleArchive(account: Account) {
    setActionError(null);
    try {
      await update.mutateAsync({ id: account.id, body: { active: !account.active } });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  const newAccountButton = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <Plus />
      Nova conta
    </Button>
  );

  function renderList(list: Account[]) {
    return (
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            onEdit={(target) => setDialog({ kind: "edit", account: target })}
            onToggleArchive={toggleArchive}
            onDelete={(target) => setDialog({ kind: "delete", account: target })}
          />
        ))}
      </ul>
    );
  }

  let content;
  if (accounts.isPending) {
    content = (
      <div aria-busy="true" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          Carregando contas...
        </p>
      </div>
    );
  } else if (accounts.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(accounts.error)}
        </Alert>
        <Button variant="outline" onClick={() => void accounts.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={Landmark}
        title={showArchived ? "Nenhuma conta ainda" : "Nenhuma conta ativa"}
        description={
          showArchived
            ? "Cadastre sua primeira conta para começar."
            : "Cadastre sua primeira conta ou ative a opção para ver as arquivadas."
        }
        action={newAccountButton}
      />
    );
  } else {
    const netTotals = totalsByCurrency(items, places);
    content = (
      <div className="flex flex-col gap-8">
        {liabilities.length > 0 && <Totals label="Patrimônio líquido" totals={netTotals} />}

        {assets.length > 0 && (
          <section aria-labelledby="accounts-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="accounts-heading" className="text-lg font-semibold">
                Contas
              </h2>
              <Totals label="Total" totals={totalsByCurrency(assets, places)} />
            </div>
            {renderList(assets)}
          </section>
        )}

        {liabilities.length > 0 && (
          <section aria-labelledby="debts-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="debts-heading" className="text-lg font-semibold">
                Dívidas
              </h2>
              <Totals
                label="Total devido"
                totals={totalsByCurrency(liabilities, places).map((t) => ({
                  currency: t.currency,
                  total: negateMoney(t.total),
                }))}
              />
            </div>
            {renderList(liabilities)}
          </section>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Contas" description="Onde está o seu dinheiro e o que você deve" actions={newAccountButton} />

      <label className="mb-6 flex w-fit cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
          className="size-4 accent-[var(--primary)]"
        />
        Mostrar arquivadas
      </label>

      {actionError && (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      )}

      {content}

      {dialog?.kind === "create" && <AccountFormDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <AccountFormDialog account={dialog.account} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && <DeleteAccountDialog account={dialog.account} onClose={() => setDialog(null)} />}
    </>
  );
}
