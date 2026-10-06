import { Tags } from "lucide-react";

import { useCategories, useCreateCategory, useDeleteCategory, useUpdateCategory, type CategoryUpdate } from "@/api/labels";
import { LabelsPage } from "@/features/labels/labels-page";

const CONFIG = {
  kind: "category",
  icon: Tags,
  withColor: true,
  nameMaxLength: 100,
  takenCode: "category_name_taken",
} as const;

export default function CategoriesPage() {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();

  return (
    <LabelsPage
      config={CONFIG}
      useList={useCategories}
      onCreate={({ name, color }) => create.mutateAsync({ name, ...(color ? { color } : {}) })}
      onUpdate={(item, { name, color }) => {
        // Manda so o que mudou: omitir a cor nao mexe nela, e null limpa
        const body: CategoryUpdate = {};
        if (name !== item.name) body.name = name;
        if ((color ?? null) !== (item.color ?? null)) body.color = color;
        if (Object.keys(body).length === 0) return Promise.resolve();
        return update.mutateAsync({ id: item.id, body });
      }}
      onDelete={(item) => remove.mutateAsync(item.id)}
    />
  );
}
