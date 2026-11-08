import { ArrowLeftRight, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  defaultLayout,
  flatCards,
  moveCard,
  moveCardBy,
  moveCardToColumn,
  moveCardToOtherColumn,
  moveFlat,
  moveFlatBy,
  moveFlatToEnd,
  readLayout,
  writeLayout,
  type DashboardCardId,
  type DashboardColumn,
  type DashboardLayout,
} from "@/features/dashboard/cards";
import { cn } from "@/lib/utils";

type ColumnProps = {
  // Sem coluna: a lista unica do celular (esquerda e depois direita), sem titulo
  column: DashboardColumn | "all";
  title?: string;
  layout: DashboardLayout;
  dragging: DashboardCardId | null;
  onToggle: (id: DashboardCardId) => void;
  onChange: (next: DashboardLayout) => void;
  onGrab: (event: PointerEvent<HTMLLIElement>, id: DashboardCardId) => void;
  // Depois de arrastar, o navegador ainda dispara o clique do rotulo: sem isso, soltar a linha ligaria ou desligaria o bloco
  consumeDragClick: () => boolean;
};

function CardColumn({ column, title, layout, dragging, onToggle, onChange, onGrab, consumeDragClick }: ColumnProps) {
  const { t } = useTranslation();
  const flat = column === "all";
  const ids = flat ? flatCards(layout) : layout[column];

  return (
    <fieldset className="min-w-0" data-column={column}>
      {title ? (
        <legend className="mb-3 text-sm font-semibold text-muted-foreground">{title}</legend>
      ) : (
        <legend className="sr-only">{t("dashboard.settings.allBlocks")}</legend>
      )}
      {/* A lista tem altura minima para dar onde soltar um bloco quando a coluna fica vazia */}
      <ul className="flex min-h-12 flex-col gap-2" data-column={column}>
        {ids.map((id, index) => {
          const label = t(`dashboard.cards.${id}`);
          return (
            <li
              key={id}
              data-card-id={id}
              onPointerDown={(event) => onGrab(event, id)}
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
                  if (consumeDragClick()) event.preventDefault();
                }}
              >
                <input type="checkbox" checked={layout.enabled.includes(id)} onChange={() => onToggle(id)} className="size-4 shrink-0 accent-[var(--primary)]" />
                <span className="min-w-0 truncate">{label}</span>
              </label>
              {!flat && (
                <button
                  type="button"
                  onClick={() => onChange(moveCardToOtherColumn(layout, id))}
                  aria-label={t(column === "left" ? "dashboard.settings.moveRight" : "dashboard.settings.moveLeft", { name: label })}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <ArrowLeftRight className="size-4" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onChange(flat ? moveFlatBy(layout, id, -1) : moveCardBy(layout, id, -1))}
                disabled={index === 0}
                aria-label={t("dashboard.settings.moveUp", { name: label })}
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ChevronUp className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onChange(flat ? moveFlatBy(layout, id, 1) : moveCardBy(layout, id, 1))}
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
 * Aba "Painel" das configuracoes: quais blocos aparecem na tela inicial, em que coluna e em que ordem. A linha se
 * arrasta dentro da coluna e de uma coluna para a outra (como no Mobills); os botoes fazem o mesmo pelo teclado.
 * No celular nao ha colunas: e uma lista so, na ordem em que os blocos aparecem no painel.
 */
export function DashboardSection() {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<DashboardLayout>(readLayout);
  const [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState<DashboardCardId | null>(null);
  const moved = useRef(false);
  // Abaixo de 1024 px o painel tem uma coluna so (as duas, uma embaixo da outra), entao aqui tambem so ha uma lista
  const twoColumns = useMediaQuery("(min-width: 1024px)");
  const twoColumnsRef = useRef(twoColumns);
  twoColumnsRef.current = twoColumns;
  // O ouvinte do arrastar le o layout daqui: assim sempre ve o mais recente, mesmo entre dois renders
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  function change(next: DashboardLayout) {
    setSaved(false);
    setLayout(next);
  }

  // Os eventos do arrastar ficam na janela, nao na linha: ao trocar de coluna a linha e recriada e perderia a captura
  useEffect(() => {
    if (!dragging) return;
    const id = dragging;

    function onMove(event: globalThis.PointerEvent) {
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const targetId = hit?.closest<HTMLElement>("[data-card-id]")?.dataset.cardId as DashboardCardId | undefined;
      // Fora de qualquer linha mas sobre uma coluna (vazia ou abaixo da ultima): vai para o fim dela
      const column = hit?.closest<HTMLElement>("[data-column]")?.dataset.column as DashboardColumn | undefined;
      const current = layoutRef.current;
      let next = current;
      if (twoColumnsRef.current) {
        next = targetId ? moveCard(current, id, targetId) : column ? moveCardToColumn(current, id, column) : current;
      } else {
        next = targetId ? moveFlat(current, id, targetId) : column ? moveFlatToEnd(current, id) : current;
      }
      // Nada mudou (o ponteiro ainda esta sobre a propria linha, ou ela ja e a ultima da coluna): sem render a cada pixel
      if (next === current || JSON.stringify(next) === JSON.stringify(current)) return;
      moved.current = true;
      layoutRef.current = next;
      setSaved(false);
      setLayout(next);
    }
    function onEnd() {
      setDragging(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [dragging]);

  function onGrab(event: PointerEvent<HTMLLIElement>, id: DashboardCardId) {
    const target = event.target as HTMLElement;
    if (target.closest("input, button")) return;
    // O mouse arrasta a linha toda, como no Mobills; no toque so a alca arrasta, para a pagina continuar rolando
    if (event.pointerType !== "mouse" && !target.closest("[data-grip]")) return;
    moved.current = false;
    setDragging(id);
  }

  function consumeDragClick() {
    const wasDrag = moved.current;
    moved.current = false;
    return wasDrag;
  }

  function toggle(id: DashboardCardId) {
    change({ ...layout, enabled: layout.enabled.includes(id) ? layout.enabled.filter((item) => item !== id) : [...layout.enabled, id] });
  }

  function save() {
    writeLayout(layout);
    setSaved(true);
  }

  const shared = { layout, dragging, onToggle: toggle, onChange: change, onGrab, consumeDragClick };

  return (
    <section aria-labelledby="dashboard-settings-title" className="max-w-4xl">
      <h2 id="dashboard-settings-title" className="text-base font-semibold">
        {t("dashboard.settings.question")}
      </h2>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">{t(twoColumns ? "dashboard.settings.hint" : "dashboard.settings.hintMobile")}</p>
      {twoColumns ? (
        <div className="grid grid-cols-2 gap-6">
          <CardColumn column="left" title={t("dashboard.settings.leftColumn")} {...shared} />
          <CardColumn column="right" title={t("dashboard.settings.rightColumn")} {...shared} />
        </div>
      ) : (
        <CardColumn column="all" {...shared} />
      )}
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
