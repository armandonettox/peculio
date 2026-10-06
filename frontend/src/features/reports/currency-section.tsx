import type { MonthlyBlock, ReportGroupBlock, ReportTotals } from "@/api/reports";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { BreakdownTable } from "./breakdown-table";
import { MonthlyChart } from "./monthly-chart";
import { dimensions, netClass } from "./presentation";
import { useTranslation } from "react-i18next";

type CurrencySectionProps = {
  totals: ReportTotals;
  monthly?: MonthlyBlock;
  // Um bloco por dimensao, na mesma ordem de DIMENSIONS
  grouped: (ReportGroupBlock | undefined)[];
};

/** Tudo de uma moeda: cartoes, grafico mensal e tabelas. Moedas diferentes nunca se misturam. */
export function CurrencySection({ totals, monthly, grouped }: CurrencySectionProps) {
  const { t } = useTranslation();
  const code = totals.currency_code;
  const cards = [
    { label: t("common.receita"), value: totals.income, className: "text-positive" },
    { label: t("common.despesa"), value: totals.expense, className: "text-destructive" },
    { label: t("common.resultado"), value: totals.net, className: netClass(totals.net) },
  ];

  return (
    <section aria-label={t("reports.currencySection.relatorioEm", { code })} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-primary-text">{code}</h2>
        <p className="text-sm text-muted-foreground">{t("reports.currencySection.entriesDeReceitaOuDespesa", { count: totals.count })}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label} role="group" aria-label={t("reports.currencySection.cardEm", { label: card.label, code })}>
            <CardHeader className="pb-2">
              <p className="text-sm text-muted-foreground">{card.label}</p>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-semibold tabular-nums ${card.className}`}>{formatMoney(card.value, code)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {monthly && <MonthlyChart block={monthly} />}

      {/* grid-cols-1 (minmax 0): sem isso a coluna cresce ate a largura da tabela e a pagina rola para o lado no celular */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {dimensions().map((dimension, index) => {
          const block = grouped[index];
          return block ? <BreakdownTable key={dimension.key} dimension={dimension} block={block} /> : null;
        })}
      </div>
    </section>
  );
}
