import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PwaBanners } from "@/components/pwa-banners";
import { initInstallPrompt, installPrompt, promptInstall, useInstallPrompt, type InstallPromptEvent } from "./install";
import { useOnlineStatus } from "./online";
import { createStore } from "./store";
import {
  applyUpdate,
  registerServiceWorker,
  UPDATE_CHECK_MS,
  usePwaUpdate,
  waitingWorker,
  type ContainerLike,
} from "./update";

// ---------- store ----------

describe("createStore", () => {
  it("guarda e devolve o valor", () => {
    const store = createStore(1);
    expect(store.get()).toBe(1);
    store.set(2);
    expect(store.get()).toBe(2);
  });

  it("avisa quem assinou, so quando o valor muda", () => {
    const store = createStore("a");
    const listener = vi.fn();
    store.subscribe(listener);
    store.set("b");
    store.set("b");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("quem cancelou a assinatura nao e mais avisado", () => {
    const store = createStore(0);
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    stop();
    store.set(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("um assinante que se cancela no aviso nao atrapalha os outros", () => {
    const store = createStore(0);
    const second = vi.fn();
    const stop = store.subscribe(() => stop());
    store.subscribe(second);
    store.set(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

// ---------- registro e atualizacao ----------

function fakeWorker(state = "installed") {
  const listeners: Record<string, () => void> = {};
  return {
    state,
    postMessage: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => void (listeners[type] = listener)),
    fire: (type: string) => listeners[type]?.(),
  };
}

function fakeRegistration(waiting: ReturnType<typeof fakeWorker> | null = null) {
  const listeners: Record<string, () => void> = {};
  const registration = {
    waiting,
    installing: null as ReturnType<typeof fakeWorker> | null,
    addEventListener: vi.fn((type: string, listener: () => void) => void (listeners[type] = listener)),
    update: vi.fn(async () => undefined),
    fire: (type: string) => listeners[type]?.(),
  };
  return registration;
}

function fakeContainer(registration: ReturnType<typeof fakeRegistration>, controller: unknown = {}) {
  const container = {
    controller,
    register: vi.fn(async () => registration),
    addEventListener: vi.fn(),
  };
  return container as unknown as ContainerLike & { register: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> };
}

describe("registerServiceWorker", () => {
  it("desligado (desenvolvimento e testes): nao registra nada", async () => {
    const container = fakeContainer(fakeRegistration());
    expect(await registerServiceWorker({ enabled: false, container })).toBeNull();
    expect(container.register).not.toHaveBeenCalled();
  });

  it("navegador sem suporte: nao faz nada", async () => {
    expect(await registerServiceWorker({ enabled: true, container: undefined })).toBeNull();
  });

  it("registra o /sw.js", async () => {
    const container = fakeContainer(fakeRegistration());
    await registerServiceWorker({ enabled: true, container, setInterval: vi.fn() });
    expect(container.register).toHaveBeenCalledWith("/sw.js");
  });

  it("se o registro falhar, o app segue sem service worker", async () => {
    const container = fakeContainer(fakeRegistration());
    container.register.mockRejectedValueOnce(new Error("bloqueado"));
    expect(await registerServiceWorker({ enabled: true, container })).toBeNull();
  });

  it("versao nova ja esperando: avisa", async () => {
    const waiting = fakeWorker();
    const onWaiting = vi.fn();
    await registerServiceWorker({ enabled: true, container: fakeContainer(fakeRegistration(waiting)), onWaiting, setInterval: vi.fn() });
    expect(onWaiting).toHaveBeenCalledWith(waiting);
  });

  it("primeira instalacao (ninguem controlava a pagina): nao ha o que atualizar", async () => {
    const onWaiting = vi.fn();
    await registerServiceWorker({
      enabled: true,
      container: fakeContainer(fakeRegistration(fakeWorker()), null),
      onWaiting,
      setInterval: vi.fn(),
    });
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it("versao que termina de instalar depois: avisa so quando chega em installed", async () => {
    const registration = fakeRegistration();
    const onWaiting = vi.fn();
    await registerServiceWorker({ enabled: true, container: fakeContainer(registration), onWaiting, setInterval: vi.fn() });
    const installing = fakeWorker("installing");
    registration.installing = installing;
    registration.fire("updatefound");
    installing.fire("statechange");
    expect(onWaiting).not.toHaveBeenCalled();
    installing.state = "installed";
    installing.fire("statechange");
    expect(onWaiting).toHaveBeenCalledWith(installing);
  });

  it("na primeira instalacao, terminar de instalar nao e 'versao nova'", async () => {
    const registration = fakeRegistration();
    const onWaiting = vi.fn();
    await registerServiceWorker({ enabled: true, container: fakeContainer(registration, null), onWaiting, setInterval: vi.fn() });
    const installing = fakeWorker("installed");
    registration.installing = installing;
    registration.fire("updatefound");
    installing.fire("statechange");
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it("confere versao nova a cada hora", async () => {
    const registration = fakeRegistration();
    const schedule = vi.fn();
    await registerServiceWorker({ enabled: true, container: fakeContainer(registration), setInterval: schedule });
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), UPDATE_CHECK_MS);
    expect(UPDATE_CHECK_MS).toBe(60 * 60 * 1000);
    schedule.mock.calls[0][0]();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it("confere tambem ao voltar para a aba, e nao quando ela some", async () => {
    const registration = fakeRegistration();
    let onChange = () => {};
    const doc = {
      visibilityState: "hidden" as DocumentVisibilityState,
      addEventListener: vi.fn((_type: string, listener: () => void) => void (onChange = listener)),
    };
    await registerServiceWorker({ enabled: true, container: fakeContainer(registration), document: doc, setInterval: vi.fn() });
    onChange();
    expect(registration.update).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    onChange();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it("uma conferencia que falha (sem rede) nao quebra nada", async () => {
    const registration = fakeRegistration();
    registration.update.mockRejectedValueOnce(new Error("offline"));
    const schedule = vi.fn();
    await registerServiceWorker({ enabled: true, container: fakeContainer(registration), setInterval: schedule });
    expect(() => schedule.mock.calls[0][0]()).not.toThrow();
    await Promise.resolve();
  });
});

describe("applyUpdate", () => {
  it("pede ao worker que espera para assumir e recarrega uma vez quando ele assume", () => {
    const worker = fakeWorker();
    const container = { addEventListener: vi.fn() };
    const reload = vi.fn();
    applyUpdate(worker as never, container, reload);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(container.addEventListener).toHaveBeenCalledWith("controllerchange", reload, { once: true });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("usePwaUpdate", () => {
  afterEach(() => act(() => waitingWorker.set(null)));

  it("sem versao nova, nada a atualizar", () => {
    const { result } = renderHook(() => usePwaUpdate());
    expect(result.current.updateReady).toBe(false);
  });

  it("Atualizar sem versao nova esperando nao faz nada", () => {
    const addEventListener = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", { value: { addEventListener }, configurable: true });
    const { result } = renderHook(() => usePwaUpdate());
    expect(() => result.current.applyUpdate()).not.toThrow();
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it("fica pronto quando o worker novo chega, e Atualizar manda a mensagem", () => {
    const addEventListener = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", { value: { addEventListener }, configurable: true });
    const { result } = renderHook(() => usePwaUpdate());
    const worker = fakeWorker();
    act(() => waitingWorker.set(worker as never));
    expect(result.current.updateReady).toBe(true);
    result.current.applyUpdate();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function), { once: true });
  });
});

// ---------- conexao ----------

describe("useOnlineStatus", () => {
  const setOnline = (value: boolean) => Object.defineProperty(navigator, "onLine", { value, configurable: true });
  afterEach(() => setOnline(true));

  it("acompanha o aparelho ficar sem rede e voltar", () => {
    setOnline(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  it("comeca sem rede se o aparelho ja abriu assim", () => {
    setOnline(false);
    expect(renderHook(() => useOnlineStatus()).result.current).toBe(false);
  });
});

// ---------- instalar ----------

function fakeInstallEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as InstallPromptEvent;
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe("instalar o app", () => {
  beforeEach(() => installPrompt.set(null));

  it("guarda o convite do navegador e impede que ele apareca sozinho", () => {
    const target = new EventTarget() as unknown as Window;
    initInstallPrompt(target);
    const event = fakeInstallEvent();
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(installPrompt.get()).toBe(event);
  });

  it("depois de instalado, o convite some", () => {
    const target = new EventTarget() as unknown as Window;
    initInstallPrompt(target);
    target.dispatchEvent(fakeInstallEvent());
    target.dispatchEvent(new Event("appinstalled"));
    expect(installPrompt.get()).toBeNull();
  });

  it("promptInstall abre o convite, devolve a escolha e so serve uma vez", async () => {
    const event = fakeInstallEvent("dismissed");
    installPrompt.set(event);
    expect(await promptInstall()).toBe("dismissed");
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(installPrompt.get()).toBeNull();
    expect(await promptInstall()).toBe("unavailable");
  });

  it("aceitar devolve accepted", async () => {
    installPrompt.set(fakeInstallEvent("accepted"));
    expect(await promptInstall()).toBe("accepted");
  });

  it("useInstallPrompt diz se da para instalar", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
    act(() => installPrompt.set(fakeInstallEvent()));
    expect(result.current.canInstall).toBe(true);
  });
});

// ---------- avisos na tela ----------

describe("PwaBanners", () => {
  const setOnline = (value: boolean) => Object.defineProperty(navigator, "onLine", { value, configurable: true });
  afterEach(() => {
    setOnline(true);
    act(() => waitingWorker.set(null));
  });

  it("em uso normal nao mostra nada", () => {
    const { container } = render(<PwaBanners />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sem rede mostra o aviso e ele some quando a rede volta", () => {
    setOnline(false);
    render(<PwaBanners />);
    expect(screen.getByRole("status")).toHaveTextContent("Sem conexão");
    expect(screen.getByRole("status")).toHaveTextContent("nada fica guardado no aparelho");
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText(/Sem conexão/)).not.toBeInTheDocument();
  });

  it("versao nova mostra o botao Atualizar, que manda o worker assumir", async () => {
    const addEventListener = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", { value: { addEventListener }, configurable: true });
    const worker = fakeWorker();
    render(<PwaBanners />);
    act(() => waitingWorker.set(worker as never));
    expect(screen.getByText("Nova versão disponível.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("os dois avisos podem aparecer juntos", () => {
    setOnline(false);
    render(<PwaBanners />);
    act(() => waitingWorker.set(fakeWorker() as never));
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });
});
