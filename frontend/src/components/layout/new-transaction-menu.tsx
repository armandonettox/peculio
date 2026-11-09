import { ArrowLeftRight, CreditCard, TrendingDown, TrendingUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CardFormDialog, ExpenseFormDialog, IncomeFormDialog } from "@/features/transactions/expense-form-dialog";
import { TransferFormDialog } from "@/features/transactions/transfer-form-dialog";
import type { Kind } from "@/features/transactions/form-model";

type DialogOption = Kind | "withdrawal-card";

type Props = {
  // O botao que abre o menu (o menu lateral e a barra inferior usam botoes diferentes)
  children: ReactNode;
  side?: "right" | "top";
  align?: "start" | "center" | "end";
};

/**
 * Menu "novo lancamento": despesa, receita, despesa de cartao e transferencia. Cada opcao abre o formulario proprio.
 * Fica aqui, e nao no botao, para o menu lateral do desktop e a barra inferior do celular abrirem os mesmos formularios.
 */
export function NewTransactionMenu({ children, side = "right", align = "start" }: Props) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogOption | null>(null);

  const options: { option: DialogOption; label: string; icon: React.ElementType; color: string }[] = [
    { option: "withdrawal", label: t("components.sidebarNewButton.despesa"), icon: TrendingDown, color: "text-red-500" },
    { option: "deposit", label: t("components.sidebarNewButton.receita"), icon: TrendingUp, color: "text-green-500" },
    { option: "withdrawal-card", label: t("components.sidebarNewButton.despesaCartao"), icon: CreditCard, color: "text-orange-500" },
    { option: "transfer", label: t("components.sidebarNewButton.transferencia"), icon: ArrowLeftRight, color: "text-blue-500" },
  ];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent side={side} align={align} className="w-44">
          {options.map(({ option, label, icon: Icon, color }) => (
            <DropdownMenuItem key={option} onClick={() => setDialog(option)} className="gap-2">
              <Icon className={`size-4 ${color}`} />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "withdrawal" && <ExpenseFormDialog onClose={() => setDialog(null)} />}
      {dialog === "deposit" && <IncomeFormDialog onClose={() => setDialog(null)} />}
      {dialog === "transfer" && <TransferFormDialog onClose={() => setDialog(null)} />}
      {dialog === "withdrawal-card" && <CardFormDialog onClose={() => setDialog(null)} />}
    </>
  );
}
