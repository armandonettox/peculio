import { Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";

type Props = {
  codes: string[];
  onDone: () => void;
};

/**
 * Mostra os codigos de recuperacao uma unica vez. So deixa concluir depois que a pessoa marca
 * que guardou: o servidor guarda apenas o hash e nao consegue mostrar de novo.
 */
export function RecoveryCodesView({ codes, onDone }: Props) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Guarde estes códigos em um lugar seguro. Cada um entra uma vez, caso você perca o acesso ao app
        autenticador. Eles não aparecem de novo.
      </p>

      <ul aria-label="Códigos de recuperação" className="grid grid-cols-2 gap-2 rounded-md border bg-muted p-3 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          <Copy />
          Copiar códigos
        </Button>
        <p role="status" className="text-xs text-muted-foreground">
          {copied === "ok" && "Códigos copiados."}
          {copied === "fail" && "Não foi possível copiar. Selecione e copie à mão."}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-0.5 accent-[var(--primary)]"
        />
        Guardei meus códigos em um lugar seguro
      </label>

      <DialogFooter>
        <Button type="button" onClick={onDone} disabled={!saved}>
          Concluir
        </Button>
      </DialogFooter>
    </div>
  );
}
