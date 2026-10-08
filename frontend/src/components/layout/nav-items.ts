import {
  ArrowLeftRight,
  BarChart3,
  Coins,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  Tags,
  Upload,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type NavLabelKey = `nav.${keyof typeof import("@/i18n/locales/pt-BR.json")["nav"]}`;

export type NavItem = {
  // Chave do texto em src/i18n/locales (nav.*)
  labelKey: NavLabelKey;
  icon: LucideIcon;
  // Sem `to` o item aparece desabilitado ("Em breve"). Ligar quando a tela existir.
  to?: string;
};

export const navItems: NavItem[] = [
  { labelKey: "nav.dashboard", icon: LayoutDashboard, to: "/" },
  { labelKey: "nav.accounts", icon: Landmark, to: "/contas" },
  { labelKey: "nav.transactions", icon: ArrowLeftRight, to: "/transacoes" },
  { labelKey: "nav.import", icon: Upload, to: "/importar" },
  { labelKey: "nav.categories", icon: Tags, to: "/categorias" },
  { labelKey: "nav.budgets", icon: PiggyBank, to: "/orcamentos" },
  { labelKey: "nav.bills", icon: Receipt, to: "/contas-a-pagar" },
  { labelKey: "nav.piggyBanks", icon: Coins, to: "/cofrinhos" },
  { labelKey: "nav.rules", icon: Workflow, to: "/regras" },
  { labelKey: "nav.reports", icon: BarChart3, to: "/relatorios" },
];
