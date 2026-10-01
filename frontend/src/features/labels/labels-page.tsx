import type { UseQueryResult } from "@tanstack/react-query";
import { MoreVertical, Pencil, Plus, Search, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { LabelChip } from "@/components/label-chip";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
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

export type LabelItem = { id: string; name: string; color?: string | null };

type Config = {
  title: string;
  description: string;
  icon: LucideIcon;
  // "categoria" / "tag": entra nos textos
  noun: string;
  // "Nova categoria" / "Nova tag"
  newLabel: string;
  plural: string;
  // Genero dos textos: categoria e feminino, tag tambem
  withColor: boolean;
  nameMaxLength: number;
  takenCode: string;
  deleteConsequence: string;
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
  const [searchText, setSearchText] = useState("");
  const search = useDebouncedValue(searchText.trim());
  const [dialog, setDialog] = useState<DialogState>(null);
  const query = useList({ search });
  const items = query.data?.items ?? [];
  const searching = search !== "";

  const newButton = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <Plus />
      {config.newLabel}
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
          Carregando {config.plural}...
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
          Tentar de novo
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    content = searching ? (
      <EmptyState
        icon={Search}
        title="Nada encontrado"
        description={`Nenhuma ${config.noun} tem “${search}” no nome.`}
      />
    ) : (
      <EmptyState
        icon={config.icon}
        title={`Nenhuma ${config.noun} ainda`}
        description={`Crie a sua primeira ${config.noun} para começar a organizar.`}
        action={newButton}
      />
    );
  } else {
    content = (
      <>
        <p className="mb-3 text-sm text-muted-foreground">
          {query.data!.total} {query.data!.total === 1 ? config.noun : config.plural}
          {searching ? ` com “${search}”` : ""}
        </p>
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-card-foreground shadow-sm"
            >
              <LabelChip name={item.name} color={item.color} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Ações de ${item.name}`}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MoreVertical className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40">
                  <DropdownMenuItem onSelect={() => setDialog({ kind: "edit", item })}>
                    <Pencil />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setDialog({ kind: "delete", item })} className="text-destructive">
                    <Trash2 />
                    Excluir
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
    nameMaxLength: config.nameMaxLength,
    takenCode: config.takenCode,
    onClose: () => setDialog(null),
  };

  return (
    <>
      <PageHeader title={config.title} description={config.description} actions={newButton} />

      <div className="relative mb-6 max-w-sm">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label={`Buscar ${config.noun}`}
          placeholder={`Buscar ${config.noun}`}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          className="pl-9"
        />
      </div>

      {content}

      {dialog?.kind === "create" && (
        <LabelFormDialog
          {...shared}
          title={config.newLabel}
          description={`Dê um nome${config.withColor ? " e uma cor" : ""} para a ${config.noun}.`}
          initial={{ name: "", color: null }}
          submitLabel="Criar"
          onSubmit={onCreate}
        />
      )}
      {dialog?.kind === "edit" && (
        <LabelFormDialog
          {...shared}
          title={`Editar ${config.noun}`}
          description={`Altere os dados da ${config.noun}.`}
          initial={{ name: dialog.item.name, color: dialog.item.color ?? null }}
          submitLabel="Salvar"
          onSubmit={(values) => onUpdate(dialog.item, values)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title={`Excluir ${config.noun}`}
          itemName={dialog.item.name}
          consequence={config.deleteConsequence}
          onConfirm={() => onDelete(dialog.item)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
