import { Tag } from "lucide-react";

import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from "@/api/labels";
import { LabelsPage } from "@/features/labels/labels-page";

const CONFIG = {
  title: "Tags",
  description: "Marque transações com palavras livres para achá-las depois: viagem, reembolso...",
  icon: Tag,
  noun: "tag",
  newLabel: "Nova tag",
  plural: "tags",
  withColor: false,
  nameMaxLength: 50,
  takenCode: "tag_name_taken",
  deleteConsequence: "Ela será removida das transações que a usam.",
};

export default function TagsPage() {
  const create = useCreateTag();
  const update = useUpdateTag();
  const remove = useDeleteTag();

  return (
    <LabelsPage
      config={CONFIG}
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
