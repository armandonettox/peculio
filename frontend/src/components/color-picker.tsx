import { normalizeHex, COLOR_SUGGESTIONS } from "@/lib/color";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ColorPickerProps = {
  // Texto do campo (o que o usuario ve). Vazio significa "sem cor".
  value: string;
  onChange: (value: string) => void;
  // Atributos de acessibilidade vindos do FormField, aplicados ao campo de texto
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

const NEUTRAL = "#808080";

/**
 * Escolha de cor livre: o seletor do navegador, o codigo em texto e atalhos. O usuario pode
 * usar qualquer cor; as amostras sao so sugestao. Quem usa valida o texto com colorError().
 */
export function ColorPicker({ value, onChange, ...fieldProps }: ColorPickerProps) {
  const current = normalizeHex(value);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Escolher a cor no seletor"
          // O seletor nativo sempre precisa de uma cor; sem escolha mostra um cinza neutro
          value={(current ?? NEUTRAL).toLowerCase()}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1"
        />
        <Input
          {...fieldProps}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#1E3A6B"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
        <button
          type="button"
          onClick={() => onChange("")}
          disabled={value === ""}
          className="h-9 shrink-0 rounded-md border border-input px-3 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Sem cor
        </button>
      </div>

      <div role="group" aria-label="Cores sugeridas" className="flex flex-wrap gap-2">
        {COLOR_SUGGESTIONS.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={`Usar a cor ${hex}`}
            aria-pressed={current === hex}
            onClick={() => onChange(hex)}
            style={{ backgroundColor: hex }}
            // O contorno garante que uma amostra branca nao suma no fundo claro nem uma preta no escuro
            className={cn(
              "size-7 rounded-full border border-foreground/30 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              current === hex && "ring-2 ring-foreground ring-offset-2 ring-offset-card",
            )}
          />
        ))}
      </div>
    </div>
  );
}
