import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "finance-app-theme";
// O botao do topo e a tela de Configuracoes usam o gancho ao mesmo tempo: este aviso mantem os dois iguais
export const THEME_EVENT = "finance-app-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStoredTheme(): Theme {
  // O localStorage pode lancar erro (janela privada, dados do site bloqueados)
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // sem armazenamento, segue o sistema
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? false;
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredTheme()),
  );

  // Outra copia do gancho trocou o tema: acompanha
  useEffect(() => {
    const onChange = (event: Event) => setThemeState((event as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  // Aplica a classe no <html> e, no modo "system", acompanha a mudanca do sistema
  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(theme);
      setResolvedTheme(resolved);
      document.documentElement.classList.toggle("dark", resolved === "dark");
    };
    apply();

    if (theme !== "system" || !window.matchMedia) return;
    const media = window.matchMedia(DARK_QUERY);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // nao salvar nao impede de trocar o tema nesta sessao
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
