import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  columnCards,
  defaultLayout,
  moveCard,
  moveCardBy,
  orderedColumn,
  readLayout,
  writeLayout,
  type DashboardCardId,
  type DashboardColumn,
  type DashboardLayout,
} from "@/features/dashboard/cards";
import { cn } from "@/lib/utils";

type ColumnProps = {
  column: DashboardColumn;
  title: string;
  layout: DashboardLayout;
  onToggle: (id: DashboardCardId) => void;
  onOrder: (order: DashboardCardId[]) => void;
};

function CardColumn({ column, title, layout, onToggle, onOrder }: ColumnProps) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState<DashboardCardId | null>(null);
  // Depois de arrastar, o navegador ainda dispara o clique do rotulo: sem isso, soltar a linha ligaria ou desligaria o bloco
  const moved = useRef(false);
  const ids = orderedColumn(layout.order, column);

  function onPointerDown(event: PointerEvent<HTMLLIElement>, id: DashboardCardId) {
    const target = event.target as HTMLElement;
    if (target.closest("input, button")) return;
    // O mouse arrasta a linha toda, como no Mobills; no toque so a alca arrasta, para a pagina continuar rolando
    if (event.pointerType !== "mouse" && !target.closest("[data-grip]")) return;
    moved.current = false;
    setDragging(id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLLIElement>) {
    if (!dragging) return;
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-card-id]");
    const targetId = row?.dataset.cardId as DashboardCardId | undefined;
    if (!targetId || targetId === dragging || !columnCards(column).includes(targetId)) return;
    moved.current = true;
    onOrder(moveCard(layout.order, dragging, targetId));
  }

  function endDrag(event: PointerEvent<HTMLLIElement>) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(null);
  }

  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-semibold text-muted-foreground">{title}</legend>
      <ul className="flex flex-col gap-2">
        {ids.map((id, index) => {
          const label = t(`dashboard.cards.${id}`);
          return (
            <li
              key={id}
              data-card-id={id}
              onPointerDown={(event) => onPointerDown(event, id)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn(
                "flex select-none items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm",
                dragging === id ? "cursor-grabbing border-primary-text shadow-md" : "cursor-grab hover:bg-muted/50",
              )}
            >
              <span data-grip className="touch-none text-muted-foreground" aria-hidden="true">
                <GripVertical className="size-4" />
              </span>
              <label
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                onClick={(event) => {
                  if (moved.current) {
                    event.preventDefault();
                    moved.current = false;
                  }
                }}
              >
                <input type="checkbox" checked={layout.enabled.includes(id)} onChange={() => onToggle(id)} className="size-4 shrink-0 accent-[var(--primary)]" />
                <span className="min-w-0 truncate">{label}</span>
              </label>
              <button
                type="button"
                onClick={() => onOrder(moveCardBy(layout.order, id, -1))}
                disabled={index === 0}
                aria-label={t("dashboard.settings.moveUp", { name: label })}
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ChevronUp className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onOrder(moveCardBy(layout.order, id, 1))}
                disabled={index === ids.length - 1}
                aria-label={t("dashboard.settings.moveDown", { name: label })}
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ChevronDown className="size-4" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/**
 * Aba "Painel" das configuracoes: quais blocos aparecem na tela inicial e em que ordem, em cada coluna. A linha
 * se arrasta dentro da propria coluna (como no Mobills) e as setas fazem o mesmo pelo teclado.
 */
export function DashboardSection() {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<DashboardLayout>(readLayout);
  const [saved, setSaved] = useState(false);

  function change(next: DashboardLayout) {
    setSaved(false);
    setLayout(next);
  }

  function toggle(id: DashboardCardId) {
    change({ ...layout, enabled: layout.enabled.includes(id) ? layout.enabled.filter((item) => item !== id) : [...layout.enabled, id] });
  }

  function save() {
    writeLayout(layout);
    setSaved(true);
  }

  return (
    <section aria-labelledby="dashboard-settings-title" className="max-w-4xl">
      <h2 id="dashboard-settings-title" className="text-base font-semibold">
        {t("dashboard.settings.question")}
      </h2>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">{t("dashboard.settings.hint")}</p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CardColumn column="left" title={t("dashboard.settings.leftColumn")} layout={layout} onToggle={toggle} onOrder={(order) => change({ ...layout, order })} />
        <CardColumn column="right" title={t("dashboard.settings.rightColumn")} layout={layout} onToggle={toggle} onOrder={(order) => change({ ...layout, order })} />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save}>
          {t("dashboard.settings.save")}
        </Button>
        <Button type="button" variant="outline" onClick={() => change(defaultLayout())}>
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
