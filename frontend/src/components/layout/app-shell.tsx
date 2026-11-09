import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { AppClockGate } from "@/components/app-clock-gate";
import { OnboardingTour } from "@/components/onboarding-tour";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { BottomNav } from "./bottom-nav";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";
import { SidebarNewButton } from "./sidebar-new-button";
import { useSidebar } from "./use-sidebar";
import { useTranslation } from "react-i18next";

export const MAIN_CONTENT_ID = "main-content";
export const SIDEBAR_ID = "sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  // So vale no desktop: no celular nao ha menu lateral, a navegacao e a barra inferior
  const { collapsed, toggle } = useSidebar();
  // Na tela inicial do celular o proprio painel traz o topo (avatar, mes e saldo): sem o cabecalho do app
  const hideHeaderOnMobile = pathname === "/";

  return (
    <div className="min-h-screen bg-background">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        {t("components.appShell.pularParaOConteudo")}
      </a>

      <aside
        id={SIDEBAR_ID}
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-card lg:flex ${collapsed ? "w-16" : "w-60"}`}
      >
        <div className={`flex h-14 items-center border-b ${collapsed ? "justify-center px-0" : "px-4"}`}>
          {!collapsed && <Brand to="/" />}
        </div>
        <SidebarNewButton collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} />
      </aside>

      <div className={collapsed ? "lg:pl-16" : "lg:pl-60"}>
        <header
          className={`sticky top-0 z-20 h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur ${hideHeaderOnMobile ? "hidden lg:flex" : "flex"}`}
        >
          {/* Desktop: mostra ou oculta o menu lateral (Ctrl+B). Sem o menu, a marca passa para o cabecalho. */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={toggle}
            aria-label={collapsed ? t("components.appShell.mostrarMenuLateral") : t("components.appShell.ocultarMenuLateral")}
            aria-expanded={!collapsed}
            aria-controls={SIDEBAR_ID}
            aria-keyshortcuts="Control+B Meta+B"
            title={collapsed ? t("components.appShell.showSidebarTitle") : t("components.appShell.hideSidebarTitle")}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>

          <span className="lg:hidden">
            <Brand to="/" />
          </span>
          {collapsed && (
            <span className="hidden lg:block">
              <Brand to="/" />
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        {/* Em monitor largo a area de conteudo cresce com ele: um teto fixo de 72rem deixava faixas vazias nas laterais */}
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="mx-auto w-full max-w-6xl p-4 max-lg:pb-28 sm:p-6 xl:max-w-7xl 2xl:max-w-[96rem]">
          {children}
        </main>
      </div>

      <BottomNav />
      <OnboardingTour />
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
