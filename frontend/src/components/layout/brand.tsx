import { Wallet } from "lucide-react";

// Marca provisoria: a identidade visual definitiva (logo e nome) entra na Fase 6
export function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Wallet className="size-4" />
      </span>
      <span className="text-base font-semibold text-primary-text">finance-app</span>
    </div>
  );
}
