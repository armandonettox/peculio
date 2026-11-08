import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  LEFT_CARDS,
  RIGHT_CARDS,
  defaultCards,
  readEnabledCards,
  writeEnabledCards,
  type DashboardCardId,
} from "@/features/dashboard/cards";

function CardColumn({
  title,
  ids,
  enabled,
  onToggle,
}: {
  title: string;
  ids: readonly DashboardCardId[];
  enabled: DashboardCardId[];
  onToggle: (id: DashboardCardId) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-semibold text-muted-foreground">{title}</legend>
      <ul className="flex flex-col gap-2">
        {ids.map((id) => (
          <li key={id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm hover:bg-muted/50">
              <input
                type="checkbox"
                checked={enabled.includes(id)}
                onChange={() => onToggle(id)}
                className="size-4 shrink-0 accent-[var(--primary)]"
              />
              {t(`dashboard.cards.${id}`)}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** Aba "Painel" das configuracoes: quais blocos aparecem na tela inicial, em cada coluna. */
export function DashboardSection() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<DashboardCardId[]>(readEnabledCards);
  const [saved, setSaved] = useState(false);

  function toggle(id: DashboardCardId) {
    setSaved(false);
    setEnabled((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function save() {
    writeEnabledCards(enabled);
    setSaved(true);
  }

  function restoreDefaults() {
    setSaved(false);
    setEnabled(defaultCards());
  }

  return (
    <section aria-labelledby="dashboard-settings-title" className="max-w-4xl">
      <h2 id="dashboard-settings-title" className="text-base font-semibold">
        {t("dashboard.settings.question")}
      </h2>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">{t("dashboard.settings.hint")}</p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CardColumn title={t("dashboard.settings.leftColumn")} ids={LEFT_CARDS} enabled={enabled} onToggle={toggle} />
        <CardColumn title={t("dashboard.settings.rightColumn")} ids={RIGHT_CARDS} enabled={enabled} onToggle={toggle} />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save}>
          {t("dashboard.settings.save")}
        </Button>
        <Button type="button" variant="outline" onClick={restoreDefaults}>
          {t("dashboard.settings.restoreDefaults")}
        </Button>
        {saved && (
          <p role="status" className="text-sm text-positive">
            {t("dashboard.settings.saved")}
          </p>
        )}
      </div>
    </section>
  );
}
