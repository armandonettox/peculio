import { CreditCard, Landmark, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAccounts, useCurrencies, useUpdateAccount, type Account } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tab, TabList } from "@/components/ui/tabs";
import { AccountCard } from "@/features/accounts/account-card";
import { AccountFormDialog } from "@/features/accounts/account-form-dialog";
import { CreditCardCard } from "@/features/accounts/credit-card-card";
import { DeleteAccountDialog } from "@/features/accounts/delete-account-dialog";
import { totalsByCurrency } from "@/features/accounts/totals";
import { formatMoney, negateMoney } from "@/lib/money";

type DialogState =
  | { kind: "create" }
  | { kind: "create-card" }
  | { kind: "edit"; account: Account }
  | { kind: "delete"; account: Account }
  | null;

type TabId = "contas" | "cartoes";

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

function OpenFinanceBanner() {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 p-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-5" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{t("pages.accounts.importacaoAutomatica")}</p>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {t("pages.accounts.emBreve")}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{t("pages.accounts.importacaoAutomaticaDesc")}</p>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("contas");
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const accounts = useAccounts({ includeArchived: showArchived });
  const currencies = useCurrencies();
  const update = useUpdateAccount();

  const places = Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places]));
  const items = accounts.data ?? [];
  const regularAccounts = items.filter((a) => a.role !== "credit_card");
  const creditCards = items.filter((a) => a.role === "credit_card");
  const assets = regularAccounts.filter((a) => a.type === "asset");
  const liabilities = regularAccounts.filter((a) => a.type === "liability");

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
  const newCardButton = (
    <Button variant="outline" onClick={() => setDialog({ kind: "create-card" })}>
      <CreditCard />
      {t("pages.accounts.novoCartao")}
    </Button>
  );

  function renderAccountList(list: Account[]) {
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

  function renderCardList(list: Account[]) {
    return (
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((account) => (
          <CreditCardCard
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
  } else if (activeTab === "contas") {
    if (regularAccounts.length === 0) {
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
      const netTotals = totalsByCurrency(regularAccounts, places);
      content = (
        <div className="flex flex-col gap-8">
          {liabilities.length > 0 && <Totals label={t("pages.accounts.patrimonioLiquido")} totals={netTotals} />}

          {assets.length > 0 && (
            <section aria-labelledby="accounts-heading" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="accounts-heading" className="text-lg font-semibold">
                  {t("pages.accounts.contas")}
                </h2>
                <Totals label={t("pages.accounts.total")} totals={totalsByCurrency(assets, places)} />
              </div>
              {renderAccountList(assets)}
            </section>
          )}

          {liabilities.length > 0 && (
            <section aria-labelledby="debts-heading" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="debts-heading" className="text-lg font-semibold">
                  {t("pages.accounts.dividas")}
                </h2>
                <Totals
                  label={t("pages.accounts.totalDevido")}
                  totals={totalsByCurrency(liabilities, places).map((t) => ({
                    currency: t.currency,
                    total: negateMoney(t.total),
                  }))}
                />
              </div>
              {renderAccountList(liabilities)}
            </section>
          )}
        </div>
      );
    }
  } else {
    // aba cartoes
    if (creditCards.length === 0) {
      content = (
        <div className="flex flex-col gap-6">
          <EmptyState
            icon={CreditCard}
            title={showArchived ? t("pages.accounts.nenhumCartaoAinda") : t("pages.accounts.nenhumCartaoAtivo")}
            description={
              showArchived
                ? t("pages.accounts.cadastreSeuPrimeiroCartao2")
                : t("pages.accounts.cadastreSeuPrimeiroCartao")
            }
            action={newCardButton}
          />
          <OpenFinanceBanner />
        </div>
      );
    } else {
      content = (
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Totals
              label={t("pages.accounts.totalFaturas")}
              totals={totalsByCurrency(creditCards, places).map((item) => ({
                currency: item.currency,
                total: negateMoney(item.total),
              }))}
            />
          </div>
          {renderCardList(creditCards)}
          <OpenFinanceBanner />
        </div>
      );
    }
  }

  return (
    <>
      <PageHeader
        title={t("pages.accounts.contas")}
        description={t("pages.accounts.ondeEstaOSeu")}
        actions={
          <div className="flex gap-2">
            {newCardButton}
            {newAccountButton}
          </div>
        }
      />

      <TabList aria-label={t("pages.accounts.contas")} className="mb-6">
        <Tab active={activeTab === "contas"} onSelect={() => setActiveTab("contas")}>
          {t("pages.accounts.abaContas")}
        </Tab>
        <Tab active={activeTab === "cartoes"} onSelect={() => setActiveTab("cartoes")}>
          {t("pages.accounts.abaCartoes")}
        </Tab>
      </TabList>

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
      {dialog?.kind === "create-card" && <AccountFormDialog presetCreditCard onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <AccountFormDialog account={dialog.account} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && <DeleteAccountDialog account={dialog.account} onClose={() => setDialog(null)} />}
    </>
  );
}
