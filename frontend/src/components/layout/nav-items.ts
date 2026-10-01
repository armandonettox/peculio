import {
  ArrowLeftRight,
  BarChart3,
  Landmark,
  LayoutDashboard,
  PiggyBank,
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
  { label: "Relatórios", icon: BarChart3 },
  { label: "Configurações", icon: Settings },
];
