import { Landmark, Plus, Wallet } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAccounts, useCurrencies, useUpdateAccount, type Account } from "@/api/accounts";
import { useNetWorth } from "@/api/dashboard";
import { getErrorMessage } from "@/api/error-messages";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AccountCard } from "@/features/accounts/account-card";
import { AccountFormDialog } from "@/features/accounts/account-form-dialog";
import { DeleteAccountDialog } from "@/features/accounts/delete-account-dialog";
import { totalsByCurrency } from "@/features/accounts/totals";
import { formatMoney, isNegativeMoney } from "@/lib/money";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; account: Account }
  | { kind: "delete"; account: Account }
  | null;

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
  const { t } = useTranslation();
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const accounts = useAccounts({ includeArchived: showArchived });
  const currencies = useCurrencies();
  const update = useUpdateAccount();
  // Mesmo numero do Painel (patrimonio de hoje, com cartoes e sem lancamentos futuros): uma fonte so para "quanto eu tenho"
  const netWorth = useNetWorth({ months: 12, forecastMonths: 3 });

  const places = Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places]));
  // Cartoes de credito ficam na pagina /cartoes
  const items = (accounts.data ?? []).filter((a) => a.role !== "credit_card");

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
      {t("pages.accounts.novaConta")}
    </Button>
  );

  let content;
  if (accounts.isPending) {
    content = (
      <div aria-busy="true" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          {t("common.carregandoContas")}
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
          {t("common.tentarDeNovo")}
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={Landmark}
        title={showArchived ? t("pages.accounts.nenhumaContaAinda") : t("pages.accounts.nenhumaContaAtiva")}
        description={
          showArchived
            ? t("pages.accounts.cadastreSuaPrimeiraConta")
            : t("pages.accounts.cadastreSuaPrimeiraConta2")
        }
        action={newAccountButton}
      />
    );
  } else {
    const activeItems = items.filter((a) => a.active);
    const mainCurrency = activeItems[0]?.currency_code ?? "BRL";
    const mainNet = netWorth.data?.currencies.find((c) => c.currency_code === mainCurrency)?.net;
    const totals = totalsByCurrency(items, places);
    content = (
      <div className="flex flex-col gap-6">
        {mainNet !== undefined && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KpiCard
              icon={Wallet}
              label={t("pages.accounts.patrimonioLiquido")}
              value={formatMoney(mainNet, mainCurrency)}
              valueColor={isNegativeMoney(mainNet) ? "destructive" : "default"}
            />
          </div>
        )}

        <Totals label={t("pages.accounts.saldoDasContas")} totals={totals} />

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("pages.accounts.nenhumaContaAtiva")}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onEdit={(target) => setDialog({ kind: "edit", account: target })}
                onToggleArchive={toggleArchive}
                onDelete={(target) => setDialog({ kind: "delete", account: target })}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t("pages.accounts.contas")}
        description={t("pages.accounts.ondeEstaOSeu")}
        actions={newAccountButton}
      />

      <label className="mb-6 flex w-fit cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
          className="size-4 accent-[var(--primary)]"
        />
        {t("pages.accounts.mostrarArquivadas")}
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
