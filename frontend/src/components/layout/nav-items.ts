import {
  ArrowLeftRight,
  BarChart3,
  CheckCheck,
  Coins,
  Landmark,
  LayoutDashboard,
  Mail,
  PiggyBank,
  Repeat,
  Receipt,
  Settings,
  Tag,
  Tags,
  Upload,
  Webhook,
  Workflow,
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
  { label: "Importar extrato", icon: Upload, to: "/importar" },
  { label: "Conciliar", icon: CheckCheck, to: "/conciliar" },
  { label: "Categorias", icon: Tags, to: "/categorias" },
  { label: "Tags", icon: Tag, to: "/tags" },
  { label: "Orçamentos", icon: PiggyBank, to: "/orcamentos" },
  { label: "Envelopes", icon: Mail, to: "/envelopes" },
  { label: "Contas a pagar", icon: Receipt, to: "/contas-a-pagar" },
  { label: "Recorrentes", icon: Repeat, to: "/recorrentes" },
  { label: "Cofrinhos", icon: Coins, to: "/cofrinhos" },
  { label: "Regras", icon: Workflow, to: "/regras" },
  { label: "Webhooks", icon: Webhook, to: "/webhooks" },
  { label: "Relatórios", icon: BarChart3, to: "/relatorios" },
  { label: "Configurações", icon: Settings },
];
