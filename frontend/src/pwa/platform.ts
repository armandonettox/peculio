// Descobre em que tipo de aparelho o app esta aberto, para o convite de instalacao dizer o caminho certo: no Android o
// navegador abre o convite sozinho (ver install.ts); no iPhone e no iPad a instalacao e manual, pelo menu Compartilhar.

export type InstallPlatform = "ios" | "android" | "other";

type NavigatorLike = Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">;

export function detectPlatform(nav: NavigatorLike = navigator): InstallPlatform {
  if (/iphone|ipad|ipod/i.test(nav.userAgent)) return "ios";
  // O iPad novo se apresenta como Mac; a diferenca e a tela de toque
  if (nav.platform === "MacIntel" && nav.maxTouchPoints > 1) return "ios";
  if (/android/i.test(nav.userAgent)) return "android";
  return "other";
}

/** O app ja foi instalado e esta aberto pelo atalho da tela inicial (sem a barra do navegador). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // O Safari do iPhone usa a propriedade propria; os outros usam o display-mode
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

const DISMISSED_KEY = "peculio-install-banner-dismissed";

// O localStorage pode lancar erro (janela privada, dados do site bloqueados): sem ele o aviso volta a cada visita
export function readInstallBannerDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeInstallBannerDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Sem armazenamento, o aviso so some ate recarregar a pagina
  }
}
