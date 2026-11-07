import {
  Baby,
  Banknote,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Coffee,
  Droplet,
  Dumbbell,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  Music,
  PawPrint,
  Phone,
  PiggyBank,
  Pizza,
  Plane,
  Receipt,
  Shirt,
  ShoppingCart,
  Tag,
  TrendingUp,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { components } from "@/api/schema";

/** Nomes que a API aceita (a lista mora no backend; o tipo gerado muda se ela mudar). */
export type CategoryIconName = NonNullable<components["schemas"]["CategoryCreate"]["icon"]>;

// Record<CategoryIconName, ...>: se o backend ganhar um nome novo e esta lista nao, o tsc acusa
const ICONS: Record<CategoryIconName, LucideIcon> = {
  house: House,
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  coffee: Coffee,
  pizza: Pizza,
  car: Car,
  fuel: Fuel,
  bus: Bus,
  plane: Plane,
  "heart-pulse": HeartPulse,
  dumbbell: Dumbbell,
  baby: Baby,
  "paw-print": PawPrint,
  "graduation-cap": GraduationCap,
  "book-open": BookOpen,
  "gamepad-2": Gamepad2,
  film: Film,
  music: Music,
  shirt: Shirt,
  gift: Gift,
  wifi: Wifi,
  phone: Phone,
  zap: Zap,
  droplet: Droplet,
  wrench: Wrench,
  receipt: Receipt,
  briefcase: Briefcase,
  wallet: Wallet,
  banknote: Banknote,
  "hand-coins": HandCoins,
  "piggy-bank": PiggyBank,
  "trending-up": TrendingUp,
  landmark: Landmark,
  tag: Tag,
};

export const CATEGORY_ICON_NAMES = Object.keys(ICONS) as CategoryIconName[];

/** O desenho do icone; sem icone (ou nome que nao conhecemos mais), o padrao e a etiqueta. */
export function categoryIconOf(name: string | null | undefined): LucideIcon {
  return (name && (ICONS as Record<string, LucideIcon>)[name]) || Tag;
}
