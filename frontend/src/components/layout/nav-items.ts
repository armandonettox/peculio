import {
  ArrowLeftRight,
  BarChart3,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Settings,
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
  { label: "Transações", icon: ArrowLeftRight },
  { label: "Categorias", icon: Tags },
  { label: "Orçamentos", icon: PiggyBank },
  { label: "Relatórios", icon: BarChart3 },
  { label: "Configurações", icon: Settings },
];
