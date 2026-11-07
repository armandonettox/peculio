import type { LucideIcon } from "lucide-react";

import { normalizeHex, readableTextColor } from "@/lib/color";
import { cn } from "@/lib/utils";
import { categoryIconOf } from "./category-icons";

type Props = {
  // Nome do icone da categoria; sem nome usa o padrao
  name?: string | null;
  // Desenho proprio (ex.: o banco de uma conta); vale mais que o nome
  icon?: LucideIcon;
  // Cor do circulo (#RRGGBB); sem cor, usa a cor principal do app
  color?: string | null;
  className?: string;
};

/** Circulo colorido com o desenho dentro. So decora: o nome da coisa sempre aparece em texto ao lado. */
export function CategoryIcon({ name, icon, color, className }: Props) {
  const Icon = icon ?? categoryIconOf(name);
  const background = color ? normalizeHex(color) : null;
  return (
    <span
      aria-hidden="true"
      style={background ? { backgroundColor: background, color: readableTextColor(background) } : undefined}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full",
        !background && "bg-primary text-primary-foreground",
        className,
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}
