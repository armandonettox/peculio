import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { AppClockGate } from "@/components/app-clock-gate";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UserMenu } from "@/components/user-menu";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";
import { useSidebar } from "./use-sidebar";

export const MAIN_CONTENT_ID = "main-content";
export const SIDEBAR_ID = "sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  // So vale no desktop: no celular o menu e a gaveta
  const { hidden, toggle } = useSidebar();

  // Fecha a gaveta quando a rota muda por qualquer caminho (clique, voltar, avancar)
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Pular para o conteúdo
      </a>

      <aside id={SIDEBAR_ID} className={`fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card ${hidden ? "" : "lg:flex"}`}>
        <div className="flex h-14 items-center border-b px-4">
          <Brand />
        </div>
        <SidebarNav />
      </aside>

      <div className={hidden ? "" : "lg:pl-60"}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <div className="flex h-14 items-center border-b px-4">
                <SheetTitle className="sr-only">Menu</SheetTitle>
                <SheetDescription className="sr-only">Navegação principal do aplicativo</SheetDescription>
                <Brand />
              </div>
              <SidebarNav onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>

          {/* Desktop: mostra ou oculta o menu lateral (Ctrl+B). Sem o menu, a marca passa para o cabecalho. */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={toggle}
            aria-label={hidden ? "Mostrar menu lateral" : "Ocultar menu lateral"}
            aria-expanded={!hidden}
            aria-controls={SIDEBAR_ID}
            aria-keyshortcuts="Control+B Meta+B"
            title={`${hidden ? "Mostrar" : "Ocultar"} menu lateral (Ctrl+B)`}
          >
            {hidden ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>

          <span className="text-base font-semibold text-primary-text lg:hidden">Pecúlio</span>
          {hidden && (
            <span className="hidden lg:block">
              <Brand />
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        {/* Em monitor largo a area de conteudo cresce com ele: um teto fixo de 72rem deixava faixas vazias nas laterais */}
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="mx-auto w-full max-w-6xl p-4 sm:p-6 xl:max-w-7xl 2xl:max-w-[96rem]">
          {children}
        </main>
      </div>
    </div>
  );
}

// Versao para o roteador: as paginas filhas entram no lugar do <Outlet />
export function AppLayout() {
  return (
    <AppShell>
      <AppClockGate>
        <Outlet />
      </AppClockGate>
    </AppShell>
  );
}
