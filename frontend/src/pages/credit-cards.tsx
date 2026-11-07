import { CreditCard, DollarSign, Plus, Sparkles, Wallet } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAccounts, useCurrencies, useUpdateAccount, type Account } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AccountFormDialog } from "@/features/accounts/account-form-dialog";
import { CreditCardCard } from "@/features/accounts/credit-card-card";
import { DeleteAccountDialog } from "@/features/accounts/delete-account-dialog";
import { totalsByCurrency } from "@/features/accounts/totals";
import { formatMoney, isNegativeMoney, negateMoney, placesOf, sumMoney } from "@/lib/money";

type InvoiceMode = "abertas" | "fechadas";

type DialogState =
  | { kind: "create-card" }
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

function OpenFinanceBanner() {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 p-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-text">
        <Sparkles className="size-5" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{t("pages.accounts.importacaoAutomatica")}</p>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary-text">
            {t("pages.accounts.emBreve")}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{t("pages.accounts.importacaoAutomaticaDesc")}</p>
      </div>
    </div>
  );
}

export default function CreditCardsPage() {
  const { t } = useTranslation();
  const [showArchived, setShowArchived] = useState(false);
  const [invoiceMode, setInvoiceMode] = useState<InvoiceMode>("abertas");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const accounts = useAccounts({ includeArchived: showArchived });
  const currencies = useCurrencies();
  const update = useUpdateAccount();

  const places = Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places]));
  const creditCards = (accounts.data ?? []).filter((a) => a.role === "credit_card");

  async function toggleArchive(account: Account) {
    setActionError(null);
    try {
      await update.mutateAsync({ id: account.id, body: { active: !account.active } });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  const newCardButton = (
    <Button onClick={() => setDialog({ kind: "create-card" })}>
      <Plus />
      {t("pages.accounts.novoCartao")}
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
  } else if (creditCards.length === 0) {
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
    const activeCards = creditCards.filter((c) => c.active);
    const mainCurrency = activeCards[0]?.currency_code ?? "BRL";
    const mainPlaces = placesOf(mainCurrency, places);

    const limiteDisponivel = activeCards
      .filter((c) => c.credit_limit != null && c.currency_code === mainCurrency)
      .reduce((acc, c) => {
        const avail = sumMoney([c.credit_limit!, c.balance], placesOf(c.currency_code, places));
        return sumMoney([acc, avail], mainPlaces);
      }, "0.00");

    const valorTotalFaturas = activeCards
      .filter((c) => c.currency_code === mainCurrency && isNegativeMoney(c.balance))
      .reduce((acc, c) => sumMoney([acc, negateMoney(c.balance)], mainPlaces), "0.00");

    const melhorCartao = activeCards
      .filter((c) => c.credit_limit != null)
      .sort((a, b) => {
        const availA = parseFloat(sumMoney([a.credit_limit!, a.balance], placesOf(a.currency_code, places)));
        const availB = parseFloat(sumMoney([b.credit_limit!, b.balance], placesOf(b.currency_code, places)));
        return availB - availA;
      })[0];

    content = (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard icon={CreditCard} label={t("pages.accounts.melhorCartaoHoje")} value={melhorCartao?.name ?? "-"} />
          <KpiCard icon={Wallet} label={t("pages.accounts.limiteDisponivelTotal")} value={formatMoney(limiteDisponivel, mainCurrency)} valueColor="positive" iconClassName="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" />
          <KpiCard icon={DollarSign} label={t("pages.accounts.totalFaturas")} value={formatMoney(valorTotalFaturas, mainCurrency)} valueColor={parseFloat(valorTotalFaturas) > 0 ? "destructive" : "default"} iconClassName="bg-destructive/10 text-destructive" />
        </div>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {creditCards.map((account) => (
            <CreditCardCard
              key={account.id}
              account={account}
              invoiceMode={invoiceMode}
              onEdit={(target) => setDialog({ kind: "edit", account: target })}
              onToggleArchive={toggleArchive}
              onDelete={(target) => setDialog({ kind: "delete", account: target })}
            />
          ))}
        </ul>
        <OpenFinanceBanner />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.creditCards")}
        description={t("pages.accounts.descricaoCartoes")}
        actions={newCardButton}
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex overflow-hidden rounded-lg border text-sm">
          <button
            type="button"
            onClick={() => setInvoiceMode("abertas")}
            className={invoiceMode === "abertas" ? "bg-primary px-4 py-1.5 font-medium text-primary-foreground" : "px-4 py-1.5 text-muted-foreground hover:bg-muted"}
          >
            {t("pages.accounts.faturasAbertas")}
          </button>
          <button
            type="button"
            onClick={() => setInvoiceMode("fechadas")}
            className={invoiceMode === "fechadas" ? "bg-primary px-4 py-1.5 font-medium text-primary-foreground" : "px-4 py-1.5 text-muted-foreground hover:bg-muted"}
          >
            {t("pages.accounts.faturasFechadas")}
          </button>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
            className="size-4 accent-[var(--primary)]"
          />
          {t("pages.accounts.mostrarArquivadas")}
        </label>
      </div>

      {actionError && (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      )}

      {content}

      {dialog?.kind === "create-card" && <AccountFormDialog presetCreditCard onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <AccountFormDialog account={dialog.account} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && <DeleteAccountDialog account={dialog.account} onClose={() => setDialog(null)} />}
    </>
  );
}
