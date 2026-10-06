import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

import { useBudgetsProgress } from "@/api/budgets";
import { useUpcoming } from "@/api/dashboard";
import { appToday } from "@/lib/dates";
import { buildAlerts } from "./presentation";
import { useTranslation } from "react-i18next";

const LEVEL_CLASS = {
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  warning: "border-warning/30 bg-warning/10 text-warning",
} as const;

/**
 * Faixa de alertas no topo do painel: contas atrasadas e orcamentos perto ou no limite.
 * Some por completo quando nao ha nada para avisar.
 */
export function AlertsBar() {
  const { t } = useTranslation();
  const upcoming = useUpcoming({ days: 30 });
  const budgets = useBudgetsProgress({ on: appToday(), includeArchived: false });

  // Enquanto carrega ou se algum dos dois falha, so nao mostra nada: a faixa e um extra, e
  // cada bloco abaixo ja avisa o proprio erro
  if (!upcoming.data || !budgets.data) return null;

  const alerts = buildAlerts(upcoming.data.items, budgets.data);
  if (alerts.length === 0) return null;

  return (
    <section aria-label={t("dashboard.alertsBar.alertas")} className="mb-6 flex flex-col gap-2">
      {alerts.map((alert) => (
        <Link
          key={alert.key}
          to={alert.href}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:underline ${LEVEL_CLASS[alert.level]}`}
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {alert.text}
        </Link>
      ))}
    </section>
  );
}
