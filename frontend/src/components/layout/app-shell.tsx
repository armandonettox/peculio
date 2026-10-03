import { Menu } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { AppClockGate } from "@/components/app-clock-gate";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UserMenu } from "@/components/user-menu";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";

export const MAIN_CONTENT_ID = "main-content";

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

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

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card lg:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Brand />
        </div>
        <SidebarNav />
      </aside>

      <div className="lg:pl-60">
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

          <span className="text-base font-semibold text-primary-text lg:hidden">finance-app</span>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="mx-auto w-full max-w-6xl p-4 sm:p-6">
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
