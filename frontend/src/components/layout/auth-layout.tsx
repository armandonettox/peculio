import { Outlet } from "react-router-dom";

import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { Brand } from "./brand";

// Moldura das telas de login e cadastro: cartao centralizado, sem sidebar
export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between p-4">
        <Brand />
        <div className="flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center p-4 pt-8 sm:items-center sm:pt-4">
        <div className="w-full max-w-sm">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
