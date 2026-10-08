import { Children, useLayoutEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Unidade de linha bem fina: cada bloco ocupa quantas linhas forem precisas para a propria altura
// medida, em vez de uma altura fixa por bloco.
const ROW_HEIGHT = 4;

type Props = {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
};

// Mede a altura de cada elemento ANTES de escrever o span de qualquer um: ler e escrever
// intercalado forca um reflow do navegador a cada item (layout thrashing), o que pesa bastante
// numa pagina que remonta com frequencia (ex. ida e volta rapida pelo menu, como num teste E2E)
function applyRowSpans(elements: HTMLElement[]) {
  const heights = elements.map((element) => element.getBoundingClientRect().height);
  elements.forEach((element, index) => {
    const span = Math.max(1, Math.ceil(heights[index] / ROW_HEIGHT));
    element.style.gridRowEnd = `span ${span}`;
  });
}

/**
 * Grade de 1 ou 2 colunas (a quantidade vem do `className`, ex. "grid-cols-1 lg:grid-cols-2") que
 * encaixa os blocos pela altura real de cada um, preenchendo o espaco que uma coluna mais curta
 * deixaria no final. A ordem no DOM (leitura e Tab) continua a mesma de sempre: so o lugar visual de
 * cada bloco na grade e recalculado, pelo "grid-auto-flow: dense" mais a altura medida de cada um.
 */
export function MasonryColumns({ children, className, ...rest }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = Array.from(container.children) as HTMLElement[];

    applyRowSpans(items);
    if (typeof ResizeObserver === "undefined") return;
    // Um observer so, para a vida inteira do componente: qualquer bloco que mude de altura (dado
    // que chega, tema que muda a quebra de linha) dispara o reflow sozinho, sem recriar nada a cada render
    const observer = new ResizeObserver((entries) => applyRowSpans(entries.map((entry) => entry.target as HTMLElement)));
    for (const item of items) observer.observe(item);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- os filhos sao fixos (sempre os mesmos blocos do painel)
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("grid items-start gap-x-6 [grid-auto-flow:dense]", className)}
      style={{ gridAutoRows: `${ROW_HEIGHT}px` }}
      {...rest}
    >
      {Children.map(children, (child, index) => (
        <div key={index} className="pb-6">
          {child}
        </div>
      ))}
    </div>
  );
}
