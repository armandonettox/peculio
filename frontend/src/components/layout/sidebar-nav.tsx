import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";
import { navItems, type NavItem } from "./nav-items";

const itemClasses =
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type SidebarNavProps = {
  // Chamado ao clicar num item. A gaveta do celular usa para fechar, mesmo quando o
  // item clicado e a pagina atual (ai a rota nao muda e nada mais fecharia a gaveta).
  onNavigate?: () => void;
  // So os testes trocam a lista (para conferir o item desabilitado, que hoje nenhum item de verdade usa)
  items?: NavItem[];
};

export function SidebarNav({ onNavigate, items = navItems }: SidebarNavProps) {
  return (
    <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto p-3">
      <ul className="flex flex-col gap-1">
        {items.map(({ label, icon: Icon, to }) => (
          <li key={label}>
            {to ? (
              <NavLink
                to={to}
                end={to === "/"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    itemClasses,
                    isActive
                      ? "bg-accent text-primary-text"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </NavLink>
            ) : (
              <span
                aria-disabled="true"
                className={cn(itemClasses, "cursor-not-allowed text-muted-foreground opacity-60")}
              >
                <Icon className="size-4 shrink-0" />
                {label}
                <span className="ml-auto shrink-0 whitespace-nowrap text-xs font-normal">Em breve</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
