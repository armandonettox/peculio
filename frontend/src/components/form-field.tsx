import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

type FormFieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  // Esconde o rotulo da vista, mas o leitor de tela continua lendo (campo que ja traz icone e texto de exemplo)
  hideLabel?: boolean;
  // Recebe os atributos de acessibilidade que ligam o campo ao erro
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
};

export function FormField({ id, label, error, hint, hideLabel = false, children }: FormFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    // min-w-0: sem isso o campo (o de data do iPhone principalmente) alarga a coluna da grade e estoura a janela
    <div className={hideLabel ? "flex min-w-0 flex-col gap-1" : "flex min-w-0 flex-col gap-2"}>
      <Label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </Label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
