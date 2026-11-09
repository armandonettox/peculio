import { Tags } from "lucide-react";

import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
  type CategoryUpdate,
} from "@/api/labels";
import type { CategoryIconName } from "@/features/labels/category-icons";
import { LabelsPage } from "@/features/labels/labels-page";

const CATEGORY_CONFIG = {
  kind: "category",
  icon: Tags,
  withColor: true,
  withIcon: true,
  withKind: true,
  nameMaxLength: 100,
  takenCode: "category_name_taken",
} as const;

export default function CategoriesPage() {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();

  return (
    <LabelsPage
      config={CATEGORY_CONFIG}
      useList={useCategories}
      onCreate={({ name, color, kind, icon }) =>
        create.mutateAsync({
          name,
          kind: kind!,
          ...(color ? { color } : {}),
          ...(icon ? { icon: icon as CategoryIconName } : {}),
        })
      }
      onUpdate={(item, { name, color, kind, icon }) => {
        // Manda so o que mudou: omitir a cor nao mexe nela, e null limpa
        const body: CategoryUpdate = {};
        if (name !== item.name) body.name = name;
        if ((color ?? null) !== (item.color ?? null)) body.color = color;
        if (kind !== item.kind) body.kind = kind!;
        if ((icon ?? null) !== (item.icon ?? null)) body.icon = icon as CategoryIconName | null;
        if (Object.keys(body).length === 0) return Promise.resolve();
        return update.mutateAsync({ id: item.id, body });
      }}
      onDelete={(item) => remove.mutateAsync(item.id)}
    />
  );
}
