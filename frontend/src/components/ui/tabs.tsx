import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type TabListProps = {
  "aria-label": string;
  className?: string;
  children: ReactNode;
};

/**
 * Fileira de abas com sublinhado na ativa (em vez de um botao com fundo solido), como no bihoster.
 * Seta esquerda/direita move o foco entre as abas, Home/End vao a primeira/ultima; mover o foco ja
 * troca a aba (ativacao automatica), igual ao padrao do navegador em abas de verdade.
 */
export function TabList({ className, children, ...props }: TabListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;

    let target: number;
    if (event.key === "ArrowRight") target = current + 1;
    else if (event.key === "ArrowLeft") target = current - 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = tabs.length - 1;
    else return;
    if (target < 0 || target >= tabs.length) return;

    event.preventDefault();
    tabs[target].focus();
    tabs[target].click();
  }

  return (
    <div ref={listRef} role="tablist" className={cn("flex flex-wrap gap-6 border-b border-border", className)} onKeyDown={onKeyDown} {...props}>
      {children}
    </div>
  );
}

type TabProps = {
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
};

export function Tab({ active, onSelect, children }: TabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "-mb-px border-b-2 px-0.5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary-text text-primary-text" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
