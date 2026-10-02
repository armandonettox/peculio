import {
  ArrowLeftRight,
  BarChart3,
  Coins,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Repeat,
  Receipt,
  Settings,
  Tag,
  Tags,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  icon: LucideIcon;
  // Sem `to` o item aparece desabilitado ("Em breve"). Ligar quando a tela existir.
  to?: string;
};

export const navItems: NavItem[] = [
  { label: "Painel", icon: LayoutDashboard, to: "/" },
  { label: "Contas", icon: Landmark, to: "/contas" },
  { label: "Transações", icon: ArrowLeftRight, to: "/transacoes" },
  { label: "Categorias", icon: Tags, to: "/categorias" },
  { label: "Tags", icon: Tag, to: "/tags" },
  { label: "Orçamentos", icon: PiggyBank, to: "/orcamentos" },
  { label: "Contas a pagar", icon: Receipt, to: "/contas-a-pagar" },
  { label: "Recorrentes", icon: Repeat, to: "/recorrentes" },
  { label: "Cofrinhos", icon: Coins, to: "/cofrinhos" },
  { label: "Relatórios", icon: BarChart3 },
  { label: "Configurações", icon: Settings },
];
