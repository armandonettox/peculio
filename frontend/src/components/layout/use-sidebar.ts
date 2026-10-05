import { useCallback, useEffect, useState } from "react";

// O menu lateral do desktop pode ficar oculto (a escolha fica neste navegador). No celular ele e a gaveta de sempre e
// esta escolha nao conta. Regras puras aqui, com testes; o AppShell so as usa.

export const SIDEBAR_STORAGE_KEY = "finance-app:sidebar-hidden";

export function readSidebarHidden(): boolean {
  // O armazenamento pode falhar (janela privada, dados do site bloqueados): nesse caso o menu fica aparente
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSidebarHidden(hidden: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, hidden ? "1" : "0");
  } catch {
    // Sem armazenamento: a escolha vale so ate fechar a pagina
  }
}

type KeyInfo = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

/** Ctrl+B (Cmd+B no Mac), sem Shift nem Alt: o atalho de mostrar e ocultar o menu. */
export function isSidebarShortcut(event: KeyInfo): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "b";
}

/** Campo onde a pessoa digita: o atalho nao pode tomar a tecla dela. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function useSidebar(): { hidden: boolean; toggle: () => void } {
  const [hidden, setHidden] = useState(readSidebarHidden);

  const toggle = useCallback(() => {
    setHidden((current) => {
      saveSidebarHidden(!current);
      return !current;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSidebarShortcut(event) || isEditableTarget(event.target)) return;
      // Ctrl+B abriria os favoritos em alguns navegadores: aqui ele e do app
      event.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return { hidden, toggle };
}
