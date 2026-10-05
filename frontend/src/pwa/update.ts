import { useSyncExternalStore } from "react";

import { createStore } from "./store";

// Registro do service worker e aviso de versao nova. A versao nova instala em segundo plano e ESPERA; so troca quando a
// pessoa clica em "Atualizar" (assim nada recarrega no meio de um lancamento).

// De quanto em quanto tempo o app pergunta ao servidor se ha versao nova (alem de quando volta para a aba)
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

type WorkerLike = Pick<ServiceWorker, "state" | "postMessage" | "addEventListener">;
type RegistrationLike = {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  addEventListener(type: "updatefound", listener: () => void): void;
  update(): Promise<unknown>;
};
export type ContainerLike = {
  controller: unknown;
  register(url: string): Promise<RegistrationLike>;
  addEventListener(type: "controllerchange", listener: () => void, options?: { once: boolean }): void;
};

// O service worker que terminou de instalar e espera aceite (null: nao ha versao nova)
export const waitingWorker = createStore<WorkerLike | null>(null);

type RegisterDeps = {
  // So no app publicado: em desenvolvimento e nos testes o service worker atrapalharia (guardaria arquivos velhos)
  enabled: boolean;
  container: ContainerLike | undefined;
  onWaiting?: (worker: WorkerLike) => void;
  // Onde o app escuta "voltei para a aba" e onde agenda a conferencia periodica
  document?: Pick<Document, "addEventListener" | "visibilityState">;
  setInterval?: (handler: () => void, ms: number) => unknown;
};

/** Registra o service worker. Devolve o registro, ou null se nao ha suporte, esta desligado ou o registro falhou. */
export async function registerServiceWorker({
  enabled,
  container,
  onWaiting = (worker) => waitingWorker.set(worker),
  document: doc = globalThis.document,
  setInterval: schedule = (handler, ms) => globalThis.setInterval(handler, ms),
}: RegisterDeps): Promise<RegistrationLike | null> {
  if (!enabled || !container) return null;
  let registration: RegistrationLike;
  try {
    registration = await container.register("/sw.js");
  } catch {
    // Sem service worker o app continua funcionando normalmente, so nao instala offline
    return null;
  }

  // "Versao nova" so existe se ja havia um worker controlando a pagina: na primeira instalacao nao ha o que atualizar
  const announce = (worker: WorkerLike) => {
    if (container.controller) onWaiting(worker);
  };

  if (registration.waiting) announce(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    installing?.addEventListener("statechange", () => {
      if (installing.state === "installed") announce(installing);
    });
  });

  const check = () => void registration.update().catch(() => undefined);
  schedule(check, UPDATE_CHECK_MS);
  doc?.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "visible") check();
  });
  return registration;
}

/** Aceita a versao nova: o worker que esperava assume e a pagina recarrega uma vez, ja com o codigo novo. */
export function applyUpdate(
  worker: WorkerLike,
  container: Pick<ContainerLike, "addEventListener">,
  reload: () => void = () => globalThis.location.reload(),
): void {
  container.addEventListener("controllerchange", reload, { once: true });
  worker.postMessage({ type: "SKIP_WAITING" });
}

export function usePwaUpdate(): { updateReady: boolean; applyUpdate: () => void } {
  const worker = useSyncExternalStore(waitingWorker.subscribe, waitingWorker.get);
  return {
    updateReady: worker !== null,
    applyUpdate: () => {
      if (worker && navigator.serviceWorker) applyUpdate(worker, navigator.serviceWorker);
    },
  };
}
