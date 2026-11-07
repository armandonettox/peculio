import { ArrowLeftRight, CreditCard, Plus, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CardFormDialog, ExpenseFormDialog, IncomeFormDialog } from "@/features/transactions/expense-form-dialog";
import { TransferFormDialog } from "@/features/transactions/transfer-form-dialog";
import type { Kind } from "@/features/transactions/form-model";

type DialogOption = Kind | "withdrawal-card";

type Props = {
  collapsed: boolean;
};

export function SidebarNewButton({ collapsed }: Props) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogOption | null>(null);

  const options: { option: DialogOption; label: string; icon: React.ElementType; color: string }[] = [
    { option: "withdrawal", label: t("components.sidebarNewButton.despesa"), icon: TrendingDown, color: "text-red-500" },
    { option: "deposit", label: t("components.sidebarNewButton.receita"), icon: TrendingUp, color: "text-green-500" },
    { option: "withdrawal-card", label: t("components.sidebarNewButton.despesaCartao"), icon: CreditCard, color: "text-orange-500" },
    { option: "transfer", label: t("components.sidebarNewButton.transferencia"), icon: ArrowLeftRight, color: "text-blue-500" },
  ];

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
    <>
      <div className={collapsed ? "flex justify-center px-3 py-2" : "px-3 py-2"}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-44">
            {options.map(({ option, label, icon: Icon, color }) => (
              <DropdownMenuItem key={option} onClick={() => setDialog(option)} className="gap-2">
                <Icon className={`size-4 ${color}`} />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {dialog === "withdrawal" && <ExpenseFormDialog onClose={() => setDialog(null)} />}
      {dialog === "deposit" && <IncomeFormDialog onClose={() => setDialog(null)} />}
      {dialog === "transfer" && <TransferFormDialog onClose={() => setDialog(null)} />}
      {dialog === "withdrawal-card" && <CardFormDialog onClose={() => setDialog(null)} />}
    </>
  );
}
