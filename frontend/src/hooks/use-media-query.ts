import { useEffect, useState } from "react";

/** Diz se a consulta de tela (ex.: "(min-width: 1024px)") vale agora, e acompanha quando a janela muda. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
