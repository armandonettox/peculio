import { vi } from "vitest";

// O jsdom nao implementa matchMedia. Este mock deixa o teste escolher o tema do sistema
// e simular o usuario trocando de tema enquanto o app esta aberto.
export function mockMatchMedia(initialMatches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: initialMatches,
    addEventListener: (_event: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback),
  };
  vi.stubGlobal("matchMedia", () => media);

  return {
    setMatches(value: boolean) {
      media.matches = value;
      listeners.forEach((callback) => callback());
    },
    listenerCount: () => listeners.size,
  };
}
