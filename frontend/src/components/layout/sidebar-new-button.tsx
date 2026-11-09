import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { NewTransactionMenu } from "./new-transaction-menu";

type Props = {
  collapsed: boolean;
};

export function SidebarNewButton({ collapsed }: Props) {
  const { t } = useTranslation();

  const trigger = collapsed ? (
    <Button
      size="icon"
      className="size-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
      aria-label={t("components.sidebarNewButton.novoLancamento")}
      title={t("components.sidebarNewButton.novoLancamento")}
    >
      <Plus className="size-4" />
    </Button>
  ) : (
    <Button className="w-full justify-start gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
      <Plus className="size-4" />
      {t("components.sidebarNewButton.novoLancamento")}
    </Button>
  );

  return (
    <div className={collapsed ? "flex justify-center px-3 py-2" : "px-3 py-2"}>
      <NewTransactionMenu>{trigger}</NewTransactionMenu>
    </div>
  );
}
