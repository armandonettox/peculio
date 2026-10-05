// Um valor guardado fora do React, que as telas assinam com useSyncExternalStore. Serve para o que acontece antes de o
// React montar (o navegador oferece instalar o app, o service worker novo termina de instalar) e nao pode se perder.

export type Store<T> = {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
};

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
