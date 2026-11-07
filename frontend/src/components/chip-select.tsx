import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export type ChipOption = {
  value: string;
  label: string;
  // Texto menor embaixo do nome (ex.: a moeda de uma conta)
  hint?: string;
  // Desenho na frente (um CategoryIcon, por exemplo)
  leading?: ReactNode;
};

type Props = {
  // Atributos de acessibilidade vindos do FormField; o id liga o rotulo ao botao
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  value: string;
  options: ChipOption[];
  onChange: (value: string) => void;
  // Mostrado quando o valor atual nao esta nas opcoes
  placeholder: string;
  className?: string;
};

const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Seletor com busca, onde cada opcao tem um desenho na frente e o escolhido vira um "chip". E um combobox de verdade:
 * o botao abre uma lista com campo de busca, as setas andam, Enter escolhe e Esc fecha so a lista (nao o dialogo).
 */
export function ChipSelect({ value, options, onChange, placeholder, className, ...fieldProps }: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((option) => option.value === value);
  const visible = useMemo(() => {
    const wanted = plain(query.trim());
    if (!wanted) return options;
    return options.filter((option) => plain(`${option.label} ${option.hint ?? ""}`).includes(wanted));
  }, [options, query]);

  function close(returnFocus: boolean) {
    setOpen(false);
    setQuery("");
    if (returnFocus) button.current?.focus();
  }

  function choose(option: ChipOption) {
    onChange(option.value);
    close(true);
  }

  function openList() {
    const index = options.findIndex((option) => option.value === value);
    setActive(Math.max(index, 0));
    setQuery("");
    setOpen(true);
  }

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Esc fecha so a lista. O dialogo escuta o Esc no documento (fase de captura), entao a lista escuta antes, na janela.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close(true);
    };
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open, listId]);

  function handleSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, Math.max(visible.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      // Enter aqui escolhe a opcao; nao pode enviar o formulario
      event.preventDefault();
      const option = visible[active];
      if (option) choose(option);
    }
  }

  return (
    <div ref={root} className={cn("relative min-w-0", className)}>
      <button
        ref={button}
        {...fieldProps}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(false) : openList())}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-none border-0 border-b border-input bg-transparent px-0 text-left text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-0 aria-[invalid=true]:border-destructive"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.leading}
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-card text-card-foreground shadow-lg">
          <input
            ref={search}
            type="text"
            role="searchbox"
            aria-label={t("components.chipSelect.search")}
            aria-controls={listId}
            aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={handleSearchKey}
            placeholder={t("components.chipSelect.search")}
            className="w-full rounded-t-md border-0 border-b bg-transparent px-3 py-2 text-sm focus-visible:outline-none"
          />
          <ul id={listId} role="listbox" className="max-h-56 overflow-y-auto py-1">
            {visible.length === 0 && (
              <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">
                {t("components.chipSelect.empty")}
              </li>
            )}
            {visible.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                  index === active && "bg-accent",
                  option.value === value && "font-medium",
                )}
              >
                {option.leading}
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.hint && <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
