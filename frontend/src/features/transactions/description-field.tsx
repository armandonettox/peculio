import { Heart, History } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSuggestions, type FavoriteType, type Suggestion } from "@/api/favorites";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useListDismiss } from "@/hooks/use-list-dismiss";
import { cn } from "@/lib/utils";

type Props = {
  // Atributos de acessibilidade vindos do FormField
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  // Sentido do lancamento: as sugestoes sao so desse sentido
  type: FavoriteType;
  // Coracao: a descricao (com categoria e conta) entra para os favoritos quando o lancamento e salvo
  favorite: boolean;
  onToggleFavorite: () => void;
  // Escolher uma sugestao: quem usa preenche descricao, categoria e conta
  onPick: (suggestion: Suggestion) => void;
  // Texto de apoio de uma sugestao (ex.: "Mercado · Itau"); vazio se nao ha o que mostrar
  describe: (suggestion: Suggestion) => string;
  // Cor do coracao ligado (a mesma do valor: vermelho na despesa, verde na receita)
  heartClassName: string;
  underlined: string;
};

/**
 * Campo de descricao com sugestoes. Ao digitar, mostra os favoritos e o que ja foi lancado; escolher um preenche a
 * descricao, a categoria e a conta (nunca o valor). O coracao marca a descricao como favorita.
 */
export function DescriptionField({
  value,
  onChange,
  placeholder,
  type,
  favorite,
  onToggleFavorite,
  onPick,
  describe,
  heartClassName,
  underlined,
  ...fieldProps
}: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const search = useDebouncedValue(value.trim());
  const query = useSuggestions(type, search, { enabled: open && search.length > 0 });
  // Resultado da busca de um texto antigo some assim que o texto muda (a busca nova ainda esta no debounce)
  const items = search === value.trim() ? (query.data ?? []) : [];
  const visible = open && items.length > 0;

  function close(returnFocus: boolean) {
    setOpen(false);
    setActive(-1);
    if (returnFocus) document.getElementById(fieldProps.id ?? "")?.focus();
  }

  function pick(suggestion: Suggestion) {
    onPick(suggestion);
    close(true);
  }

  useListDismiss(visible, root, close);

  function handleKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, -1));
    } else if (event.key === "Enter" && active >= 0 && items[active]) {
      // Com uma sugestao em destaque, Enter escolhe; sem nenhuma, Enter envia o formulario como sempre
      event.preventDefault();
      pick(items[active]!);
    }
  }

  return (
    <div ref={root} className="relative min-w-0">
      <div className="flex items-center gap-2">
        <Input
          {...fieldProps}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={visible ? listId : undefined}
          aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={handleKey}
          className={underlined}
        />
        <button
          type="button"
          aria-pressed={favorite}
          aria-label={favorite ? t("transactions.descriptionField.unfavorite") : t("transactions.descriptionField.favorite")}
          title={favorite ? t("transactions.descriptionField.unfavorite") : t("transactions.descriptionField.favorite")}
          onClick={onToggleFavorite}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Heart aria-hidden="true" className={cn("size-4", favorite && cn("fill-current", heartClassName))} />
        </button>
      </div>

      {visible && (
        // Manter o foco no campo ao clicar na lista: sem isso o campo perde o foco antes do clique chegar na opcao
        <ul
          id={listId}
          role="listbox"
          aria-label={t("transactions.descriptionField.suggestions")}
          onMouseDown={(event) => event.preventDefault()}
          className="absolute left-0 right-10 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-card py-1 text-card-foreground shadow-lg"
        >
          {items.map((item, index) => {
            const hint = describe(item);
            return (
              <li
                key={`${item.favorite_id ?? "h"}-${item.description}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(item)}
                className={cn("flex cursor-pointer items-center gap-2 px-3 py-2 text-sm", index === active && "bg-accent")}
              >
                {item.favorite_id ? (
                  <Heart aria-hidden="true" className={cn("size-3.5 shrink-0 fill-current", heartClassName)} />
                ) : (
                  <History aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="block truncate">
                    {item.description}
                    {item.favorite_id && <span className="sr-only"> ({t("transactions.descriptionField.favoriteTag")})</span>}
                  </span>
                  {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
