import { useEffect, useState } from "react";

// Devolve o valor so depois de ele ficar parado por `delay` ms. Evita uma busca na API a cada
// tecla digitada.
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
