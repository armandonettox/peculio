import { useEffect, useState } from "react";

const MIN_WIDTH = 240;

/**
 * Largura real do elemento, para o viewBox acompanhar os pixels e o texto do grafico nao encolher em
 * tela estreita. Sem medida (jsdom, primeira pintura) usa `fallback`. O `ref` e uma funcao, entao
 * a medida comeca quando o elemento aparece, mesmo que ele entre depois (ex: dados que chegam).
 */
export function useContainerWidth<T extends HTMLElement>(fallback = 640) {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const measured = Math.round(element.getBoundingClientRect().width);
      if (measured > 0) setWidth(Math.max(MIN_WIDTH, measured));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { ref: setElement, width };
}
