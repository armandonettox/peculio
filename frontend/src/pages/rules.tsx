import { FolderPlus, History, MoreVertical, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { useMemo, useState } from "react";

import { useAccounts } from "@/api/accounts";
import { useBills } from "@/api/bills";
import { useBudgets } from "@/api/budgets";
import { getErrorMessage } from "@/api/error-messages";
import { useCategories, useTags } from "@/api/labels";
import {
  useDeleteRule,
  useDeleteRuleGroup,
  useRuleGroups,
  useRules,
  useUpdateRule,
  type Rule,
  type RuleGroup,
} from "@/api/rules";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
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
import { BackfillDialog } from "@/features/rules/backfill-dialog";
import { GroupFormDialog } from "@/features/rules/group-form-dialog";
import type { NameLookups } from "@/features/rules/presentation";
import { RuleCard } from "@/features/rules/rule-card";
import { RuleFormDialog } from "@/features/rules/rule-form-dialog";
import { useTranslation } from "react-i18next";

type DialogState =
  | { kind: "new-rule" }
  | { kind: "edit-rule"; rule: Rule }
  | { kind: "delete-rule"; rule: Rule }
  | { kind: "new-group" }
  | { kind: "edit-group"; group: RuleGroup }
  | { kind: "delete-group"; group: RuleGroup }
  | { kind: "backfill" }
  | null;

function nameMap(items: { id: string; name: string }[] | undefined) {
  return new Map((items ?? []).map((item) => [item.id, item.name]));
}

export default function RulesPage() {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const rules = useRules();
  const groups = useRuleGroups();
  const accounts = useAccounts({ includeArchived: true });
  const categories = useCategories({ search: "" });
  const tags = useTags({ search: "" });
  const budgets = useBudgets({ activeOnly: false });
  const bills = useBills({ activeOnly: false });
  const update = useUpdateRule();
  const removeRule = useDeleteRule();
  const removeGroup = useDeleteRuleGroup();

  const lookups: NameLookups = useMemo(
    () => ({
      accounts: nameMap(accounts.data),
      categories: nameMap(categories.data?.items),
      tags: nameMap(tags.data?.items),
      budgets: nameMap(budgets.data),
      bills: nameMap(bills.data),
    }),
    [accounts.data, categories.data, tags.data, budgets.data, bills.data],
  );

  const ruleList = rules.data ?? [];
  const groupList = groups.data ?? [];
  const ungrouped = ruleList.filter((rule) => !rule.group_id || !groupList.some((group) => group.id === rule.group_id));

  async function toggleActive(rule: Rule) {
    setActionError(null);
    try {
      await update.mutateAsync({ id: rule.id, body: { active: !rule.active } });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  const newRuleButton = (
    <Button onClick={() => setDialog({ kind: "new-rule" })}>
      <Plus />
      {t("pages.rules.novaRegra")}
    </Button>
  );

  function renderRules(items: Rule[]) {
    return (
      <ul className="flex flex-col gap-3">
        {items.map((rule) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            lookups={lookups}
            onEdit={(item) => setDialog({ kind: "edit-rule", rule: item })}
            onToggleActive={(item) => void toggleActive(item)}
            onDelete={(item) => setDialog({ kind: "delete-rule", rule: item })}
          />
        ))}
      </ul>
    );
  }

  let content;
  if (rules.isPending || groups.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-3">
        {[0, 1].map((index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          {t("pages.rules.carregandoRegras")}
        </p>
      </div>
    );
  } else if (rules.isError || groups.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(rules.error ?? groups.error)}
        </Alert>
        <Button
          variant="outline"
          onClick={() => {
            void rules.refetch();
            void groups.refetch();
          }}
        >
          {t("common.tentarDeNovo")}
        </Button>
      </div>
    );
  } else if (ruleList.length === 0 && groupList.length === 0) {
    content = (
      <EmptyState
        icon={Workflow}
        title={t("pages.rules.nenhumaRegraAinda")}
        description={t("pages.rules.umaRegraPreencheSozinha")}
        action={newRuleButton}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-8">
        {groupList.map((group) => {
          const inGroup = ruleList.filter((rule) => rule.group_id === group.id);
          return (
            <section key={group.id} aria-label={t("pages.rules.grupo", { name: group.name })}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {group.name} <span className="font-normal">({inGroup.length})</span>
                </h2>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("pages.rules.acoesDoGrupo", { name: group.name })}
                      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <MoreVertical className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-40">
                    <DropdownMenuItem onSelect={() => setDialog({ kind: "edit-group", group })}>
                      <Pencil />
                      {t("common.editar")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setDialog({ kind: "delete-group", group })} className="text-destructive">
                      <Trash2 />
                      {t("common.excluir")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {inGroup.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {t("pages.rules.esteGrupoAindaNao")}
                </p>
              ) : (
                renderRules(inGroup)
              )}
            </section>
          );
        })}

        {ungrouped.length > 0 && (
          <section aria-label={t("pages.rules.regrasSemGrupo")}>
            <h2 className={groupList.length > 0 ? "mb-3 text-sm font-semibold text-muted-foreground" : "sr-only"}>
              {groupList.length > 0 ? t("pages.rules.semGrupo") : t("pages.rules.suasRegras")}
            </h2>
            {renderRules(ungrouped)}
          </section>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t("pages.rules.regras")}
        description={t("pages.rules.preenchemSozinhasOQue")}
        actions={
          <div className="flex flex-wrap gap-2">
            {/* Sem as regras carregadas o dialogo abriria dizendo que nao ha regras ativas */}
            <Button variant="outline" disabled={rules.isPending} onClick={() => setDialog({ kind: "backfill" })}>
              <History />
              {t("pages.rules.aplicarNasAntigas")}
            </Button>
            <Button variant="outline" onClick={() => setDialog({ kind: "new-group" })}>
              <FolderPlus />
              {t("pages.rules.novoGrupo")}
            </Button>
            {newRuleButton}
          </div>
        }
      />

      {actionError && (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      )}

      {content}

      {dialog?.kind === "new-rule" && <RuleFormDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit-rule" && <RuleFormDialog rule={dialog.rule} onClose={() => setDialog(null)} />}
      {dialog?.kind === "backfill" && (
        <BackfillDialog rules={ruleList} lookups={lookups} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "new-group" && <GroupFormDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit-group" && <GroupFormDialog group={dialog.group} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete-rule" && (
        <ConfirmDeleteDialog
          title={t("pages.rules.excluirRegra")}
          itemName={dialog.rule.name}
          consequence={t("pages.rules.asTransacoesJaPreenchidas")}
          onConfirm={() => removeRule.mutateAsync(dialog.rule.id)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete-group" && (
        <ConfirmDeleteDialog
          title={t("pages.rules.excluirGrupo")}
          itemName={dialog.group.name}
          consequence={t("pages.rules.asRegrasDoGrupo")}
          onConfirm={() => removeGroup.mutateAsync(dialog.group.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
