import { Tag, Tags } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import {
  useCategories,
  useCreateCategory,
  useCreateTag,
  useDeleteCategory,
  useDeleteTag,
  useTags,
  useUpdateCategory,
  useUpdateTag,
  type CategoryUpdate,
} from "@/api/labels";
import { PageHeader } from "@/components/layout/page-header";
import { Tab, TabList } from "@/components/ui/tabs";
import { LabelsPage } from "@/features/labels/labels-page";
import { useTranslation } from "react-i18next";

const CATEGORY_CONFIG = {
  kind: "category",
  icon: Tags,
  withColor: true,
  withKind: true,
  nameMaxLength: 100,
  takenCode: "category_name_taken",
} as const;

const TAG_CONFIG = {
  kind: "tag",
  icon: Tag,
  withColor: false,
  withKind: false,
  nameMaxLength: 50,
  takenCode: "tag_name_taken",
} as const;

type Tab = "categorias" | "tags";

function CategoriesTab() {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();

  return (
    <LabelsPage
      config={CATEGORY_CONFIG}
      useList={useCategories}
      onCreate={({ name, color, kind }) => create.mutateAsync({ name, kind: kind!, ...(color ? { color } : {}) })}
      onUpdate={(item, { name, color, kind }) => {
        // Manda so o que mudou: omitir a cor nao mexe nela, e null limpa
        const body: CategoryUpdate = {};
        if (name !== item.name) body.name = name;
        if ((color ?? null) !== (item.color ?? null)) body.color = color;
        if (kind !== item.kind) body.kind = kind!;
        if (Object.keys(body).length === 0) return Promise.resolve();
        return update.mutateAsync({ id: item.id, body });
      }}
      onDelete={(item) => remove.mutateAsync(item.id)}
    />
  );
}

function TagsTab() {
  const create = useCreateTag();
  const update = useUpdateTag();
  const remove = useDeleteTag();

  return (
    <LabelsPage
      config={TAG_CONFIG}
      useList={useTags}
      onCreate={({ name }) => create.mutateAsync({ name })}
      onUpdate={(item, { name }) => {
        if (name === item.name) return Promise.resolve();
        return update.mutateAsync({ id: item.id, body: { name } });
      }}
      onDelete={(item) => remove.mutateAsync(item.id)}
    />
  );
}

export default function LabelsTabsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get("aba");
  const tab: Tab = requested === "tags" ? "tags" : "categorias";

  function chooseTab(next: Tab) {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === "categorias") params.delete("aba");
        else params.set("aba", next);
        return params;
      },
      { replace: true },
    );
  }

  return (
    <>
      <PageHeader title={t("pages.labels.categoriasETags")} description={t("pages.labels.organizeSeusLancamentos")} />

      <TabList aria-label={t("pages.labels.secaoDeClassificacao")} className="mb-6">
        <Tab active={tab === "categorias"} onSelect={() => chooseTab("categorias")}>
          {t("pages.labels.categorias")}
        </Tab>
        <Tab active={tab === "tags"} onSelect={() => chooseTab("tags")}>
          {t("pages.labels.tags")}
        </Tab>
      </TabList>

      {tab === "categorias" ? <CategoriesTab /> : <TagsTab />}
    </>
  );
}
