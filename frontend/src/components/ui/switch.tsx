import type * as React from "react";

import { cn } from "@/lib/utils";

type Props = Omit<React.ComponentProps<"button">, "onChange" | "role" | "type"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

// Interruptor: um botao com role="switch", entao funciona com teclado (Espaco e Enter) e leitor de tela.
function Switch({ checked, onCheckedChange, className, ...props }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export { Switch };
