import {
  Car,
  Gift,
  GraduationCap,
  Hammer,
  HeartPulse,
  House,
  Laptop,
  PiggyBank,
  Plane,
  Shield,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { PiggyBankCreate } from "@/api/piggy-banks";
import { cn } from "@/lib/utils";

export type GoalIconName = NonNullable<PiggyBankCreate["icon"]>;

// Cada nome aceito pela API tem um desenho aqui. O Record exige todos: se a API ganhar um icone novo e esta lista nao,
// o tipo gerado nao compila.
const ICONS: Record<GoalIconName, LucideIcon> = {
  target: Target,
  shield: Shield,
  car: Car,
  house: House,
  hammer: Hammer,
  plane: Plane,
  "heart-pulse": HeartPulse,
  wallet: Wallet,
  "graduation-cap": GraduationCap,
  gift: Gift,
  laptop: Laptop,
  "piggy-bank": PiggyBank,
};

export const GOAL_ICON_NAMES = Object.keys(ICONS) as GoalIconName[];

// Cores para escolher (a pessoa tambem pode ficar sem cor). Escuras o bastante para o icone branco ficar legivel.
export const GOAL_COLORS = ["#1E3A6B", "#0E7490", "#7C3AED", "#15803D", "#C2410C", "#B91C1C", "#0369A1", "#A21CAF", "#4D7C0F", "#A16207"];

// Modelos prontos do "Criar objetivo", como no Mobills: cada um traz nome, icone e cor. O nome vem do idioma da tela.
export const GOAL_TEMPLATES = [
  // O personalizado nao traz icone nem cor: o cartao usa o alvo e a cor padrao do app
  { key: "custom", icon: null, color: null },
  { key: "emergency", icon: "shield", color: "#15803D" },
  { key: "car", icon: "car", color: "#7C3AED" },
  { key: "house", icon: "house", color: "#0E7490" },
  { key: "renovation", icon: "hammer", color: "#A16207" },
  { key: "vacation", icon: "plane", color: "#B91C1C" },
  { key: "medical", icon: "heart-pulse", color: "#0369A1" },
  { key: "debt", icon: "wallet", color: "#4D7C0F" },
] as const satisfies readonly { key: string; icon: GoalIconName | null; color: string | null }[];

export type GoalTemplateKey = (typeof GOAL_TEMPLATES)[number]["key"];

/** O icone de um objetivo (ou o padrao, quando ele nao tem). */
export function goalIconComponent(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name as GoalIconName]) || Target;
}

/** Bolinha com o icone do objetivo, na cor dele (ou na cor padrao do app, sem cor). */
export function GoalIconBadge({ icon, color, className }: { icon: string | null | undefined; color: string | null | undefined; className?: string }) {
  const Icon = goalIconComponent(icon);
  return (
    <span
      aria-hidden="true"
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-white", !color && "bg-primary", className)}
      style={color ? { backgroundColor: color } : undefined}
    >
      <Icon className="size-5" />
    </span>
  );
}
