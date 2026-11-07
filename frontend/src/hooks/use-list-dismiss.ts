import { useEffect, type RefObject } from "react";

/**
 * Fecha uma lista aberta (combobox) com Esc ou com um clique fora dela.
 * O Esc e tratado na janela, na fase de captura: o dialogo do Radix escuta o Esc no documento e fecharia junto, entao a
 * lista precisa ouvir antes e impedir que ele chegue la. So vale enquanto `open` for verdadeiro.
 */
export function useListDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: (returnFocus: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close(true);
    };
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
    };
    // close vem de uma funcao nova a cada render; so o estado aberto muda o que precisa ser reinstalado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
