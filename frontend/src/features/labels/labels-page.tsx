import type { UseQueryResult } from "@tanstack/react-query";
import { MoreVertical, Pencil, Plus, Search, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { LabelChip } from "@/components/label-chip";
import { EmptyState } from "@/components/layout/empty-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { LabelFormDialog, type LabelValues } from "./label-form-dialog";
import { useTranslation } from "react-i18next";

export type LabelItem = { id: string; name: string; color?: string | null; kind?: "expense" | "revenue" | null };

type Config = {
  // Cada tipo tem as suas frases completas em labels.<tipo>.* (nada de montar frase juntando o nome do tipo)
  kind: "category" | "tag";
  icon: LucideIcon;
  withColor: boolean;
  // Categoria tem tipo (saida/entrada); tag nao
  withKind: boolean;
  nameMaxLength: number;
  takenCode: string;
};

type Props = {
  config: Config;
  useList: (args: { search: string }) => UseQueryResult<{ items: LabelItem[]; total: number }>;
  onCreate: (values: LabelValues) => Promise<unknown>;
  onUpdate: (item: LabelItem, values: LabelValues) => Promise<unknown>;
  onDelete: (item: LabelItem) => Promise<unknown>;
};

type DialogState = { kind: "create" } | { kind: "edit"; item: LabelItem } | { kind: "delete"; item: LabelItem } | null;

export function LabelsPage({ config, useList, onCreate, onUpdate, onDelete }: Props) {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState("");
  const search = useDebouncedValue(searchText.trim());
  const [dialog, setDialog] = useState<DialogState>(null);
  const query = useList({ search });
  const items = query.data?.items ?? [];
  const searching = search !== "";

  const newButton = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <Plus />
      {t(`labels.${config.kind}.newLabel`)}
    </Button>
  );

  let content;
  if (query.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-2">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-14 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          {t(`labels.${config.kind}.loading`)}
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
    content = searching ? (
      <EmptyState
        icon={Search}
        title={t("labels.labelsPage.nadaEncontrado")}
        description={t(`labels.${config.kind}.noResultsFor`, { search })}
      />
    ) : (
      <EmptyState
        icon={config.icon}
        title={t(`labels.${config.kind}.emptyTitle`)}
        description={t(`labels.${config.kind}.emptyDescription`)}
        action={newButton}
      />
    );
  } else {
    content = (
      <>
        <p className="mb-3 text-sm text-muted-foreground">
          {searching
            ? t(`labels.${config.kind}.countWithSearch`, { count: query.data!.total, search })
            : t(`labels.${config.kind}.count`, { count: query.data!.total })}
        </p>
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-card-foreground shadow-sm"
            >
              <div className="flex items-center gap-2">
                <LabelChip name={item.name} color={item.color} />
                {config.withKind && item.kind && (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t(`labels.labelFormDialog.kind.${item.kind}`)}
                  </span>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("labels.labelsPage.actionsFor", { name: item.name })}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MoreVertical className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40">
                  <DropdownMenuItem onSelect={() => setDialog({ kind: "edit", item })}>
                    <Pencil />
                    {t("common.editar")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setDialog({ kind: "delete", item })} className="text-destructive">
                    <Trash2 />
                    {t("common.excluir")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const shared = {
    withColor: config.withColor,
    withKind: config.withKind,
    nameMaxLength: config.nameMaxLength,
    takenCode: config.takenCode,
    onClose: () => setDialog(null),
  };

  return (
    <>
      {/* h2, nao h1: o h1 da pagina fica por conta de quem encaixa esta aba (ver LabelsTabsPage) */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-primary-text">{t(`labels.${config.kind}.title`)}</h2>
          <p className="text-sm text-muted-foreground">{t(`labels.${config.kind}.description`)}</p>
        </div>
        <div className="flex items-center gap-2">{newButton}</div>
      </div>

      <div className="relative mb-6 max-w-sm">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label={t(`labels.${config.kind}.searchLabel`)}
          placeholder={t(`labels.${config.kind}.searchLabel`)}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          className="pl-9"
        />
      </div>

      {content}

      {dialog?.kind === "create" && (
        <LabelFormDialog
          {...shared}
          title={t(`labels.${config.kind}.newLabel`)}
          description={t(`labels.${config.kind}.createDescription`)}
          initial={{ name: "", color: null, kind: null }}
          submitLabel={t("labels.labelsPage.criar")}
          onSubmit={onCreate}
        />
      )}
      {dialog?.kind === "edit" && (
        <LabelFormDialog
          {...shared}
          title={t(`labels.${config.kind}.editTitle`)}
          description={t(`labels.${config.kind}.editDescription`)}
          initial={{ name: dialog.item.name, color: dialog.item.color ?? null, kind: dialog.item.kind ?? null }}
          submitLabel={t("labels.labelsPage.salvar")}
          onSubmit={(values) => onUpdate(dialog.item, values)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title={t(`labels.${config.kind}.deleteTitle`)}
          itemName={dialog.item.name}
          consequence={t(`labels.${config.kind}.deleteConsequence`)}
          onConfirm={() => onDelete(dialog.item)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
