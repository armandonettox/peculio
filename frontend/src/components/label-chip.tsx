import { normalizeHex, readableTextColor } from "@/lib/color";
import { cn } from "@/lib/utils";

type LabelChipProps = {
  name: string;
  // Cor escolhida pelo usuario (#RRGGBB). Sem cor, o selo fica neutro.
  color?: string | null;
  className?: string;
};

/** Selo com o nome. Com cor, o texto vira branco ou preto para ficar legivel em qualquer cor. */
export function LabelChip({ name, color, className }: LabelChipProps) {
  const background = color ? normalizeHex(color) : null;
  return (
    <span
      data-color={background ?? undefined}
      style={background ? { backgroundColor: background, color: readableTextColor(background) } : undefined}
      // O contorno evita que uma cor igual ao fundo da tela faca o selo sumir
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-md border border-foreground/20 px-2 py-0.5 text-sm font-medium",
        !background && "bg-muted text-foreground",
        className,
      )}
    >
      {name}
    </span>
  );
}
