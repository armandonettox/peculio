import { Tag } from "lucide-react";

import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from "@/api/labels";
import { LabelsPage } from "@/features/labels/labels-page";

const CONFIG = {
  kind: "tag",
  icon: Tag,
  withColor: false,
  nameMaxLength: 50,
  takenCode: "tag_name_taken",
} as const;

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
