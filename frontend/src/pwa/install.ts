import { useSyncExternalStore } from "react";

import { createStore } from "./store";

// O botao "Instalar app". O navegador (Chrome, Edge, Android) avisa que o app pode ser instalado com o evento
// `beforeinstallprompt`, as vezes antes de o React montar; por isso ele e guardado aqui desde o inicio. O Safari do
// iPhone nao tem esse evento (a instalacao la e pelo menu "Adicionar a Tela de Inicio"): o botao simplesmente nao aparece.

export type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const installPrompt = createStore<InstallPromptEvent | null>(null);

type Target = Pick<Window, "addEventListener">;

/** Comeca a escutar. Chamar uma vez, na entrada do app. */
export function initInstallPrompt(target: Target = window): void {
  target.addEventListener("beforeinstallprompt", (event) => {
    // Sem isto o navegador mostraria o convite dele na hora que quisesse; aqui o convite e o botao do menu
    event.preventDefault();
    installPrompt.set(event as InstallPromptEvent);
  });
  // Depois de instalado (por aqui ou pelo navegador) o botao nao faz mais sentido
  target.addEventListener("appinstalled", () => installPrompt.set(null));
}

/** Abre o convite do navegador. Ele so pode ser usado uma vez: depois some, aceito ou nao. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = installPrompt.get();
  if (!event) return "unavailable";
  installPrompt.set(null);
  await event.prompt();
  return (await event.userChoice).outcome;
}

export function useInstallPrompt(): { canInstall: boolean; install: () => Promise<"accepted" | "dismissed" | "unavailable"> } {
  const event = useSyncExternalStore(installPrompt.subscribe, installPrompt.get);
  return { canInstall: event !== null, install: promptInstall };
}
