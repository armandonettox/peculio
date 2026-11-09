import { Home, ListTree, MoreHorizontal, Plus, Settings, Target, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { navItems, type NavItem } from "./nav-items";
import { NewTransactionMenu } from "./new-transaction-menu";

// Fora da barra, no "Mais": tudo que a sidebar do desktop tem e nao tem lugar na barra
const BAR_ROUTES = ["/", "/transacoes", "/orcamentos"];
const moreItems: NavItem[] = [
  ...navItems.filter((item) => item.to && !BAR_ROUTES.includes(item.to)),
  { labelKey: "nav.settings", icon: Settings, to: "/configuracoes" },
];

const tabClasses =
  "flex flex-col items-center gap-1 rounded-2xl px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Tab({ to, icon: Icon, label, end = false }: { to: string; icon: LucideIcon; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn(tabClasses, isActive ? "bg-accent text-primary-text" : "text-muted-foreground hover:text-foreground")}
    >
      <Icon className="size-6" aria-hidden="true" />
      {label}
    </NavLink>
  );
}

/**
 * Barra de navegacao do celular, no pe da tela: Principal, Transacoes, o botao "+" no meio (novo lancamento),
 * Planejamento e Mais. Substitui a gaveta lateral, que so existe no desktop.
 */
export function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  // Fecha o "Mais" quando a rota muda por qualquer caminho (clique, voltar, avancar)
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const moreActive = moreItems.some((item) => item.to && pathname.startsWith(item.to));

  return (
    <nav
      aria-label={t("components.bottomNav.navegacao")}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-5 items-end px-1 pb-1 pt-1.5">
        <li className="flex justify-center">
          <Tab to="/" end icon={Home} label={t("components.bottomNav.principal")} />
        </li>
        <li className="flex justify-center">
          <Tab to="/transacoes" icon={ListTree} label={t("nav.transactions")} />
        </li>
        <li className="flex justify-center">
          <NewTransactionMenu side="top" align="center">
            <button
              type="button"
              aria-label={t("components.sidebarNewButton.novoLancamento")}
              className="-mt-7 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              <Plus className="size-7" aria-hidden="true" />
            </button>
          </NewTransactionMenu>
        </li>
        <li className="flex justify-center">
          <Tab to="/orcamentos" icon={Target} label={t("components.bottomNav.planejamento")} />
        </li>
        <li className="flex justify-center">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className={cn(tabClasses, moreActive ? "bg-accent text-primary-text" : "text-muted-foreground hover:text-foreground")}
              >
                <MoreHorizontal className="size-6" aria-hidden="true" />
                {t("components.bottomNav.mais")}
              </button>
            </SheetTrigger>
            <SheetContent className="inset-y-auto bottom-0 left-0 right-0 h-auto max-h-[85vh] w-full max-w-none overflow-y-auto rounded-t-3xl border-r-0 border-t pb-[env(safe-area-inset-bottom)]">
              <div className="px-5 pt-5">
                <SheetTitle>{t("components.bottomNav.mais")}</SheetTitle>
                <SheetDescription className="sr-only">{t("components.bottomNav.maisDescricao")}</SheetDescription>
              </div>
              <ul className="grid grid-cols-1 gap-1 p-3">
                {moreItems.map(({ labelKey, icon: Icon, to }) => (
                  <li key={labelKey}>
                    <NavLink
                      to={to as string}
                      // Fecha tambem quando a pessoa toca na pagina em que ja esta (a rota nao muda e nada mais fecharia)
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-4 rounded-2xl px-4 py-3 text-base font-medium",
                          isActive ? "bg-accent text-primary-text" : "text-foreground hover:bg-accent",
                        )
                      }
                    >
                      <Icon className="size-5 shrink-0" aria-hidden="true" />
                      {t(labelKey)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
