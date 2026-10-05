import { beforeEach, describe, expect, it, vi } from "vitest";

import { CACHE_PREFIX, OFFLINE_HTML } from "./rules";
import { registerWorker, type WorkerScope } from "./worker";

const ORIGIN = "https://app.test";
const BUILD = "v2";
const CURRENT = `${CACHE_PREFIX}${BUILD}`;

const HTML = `<!doctype html><html><head>
  <link rel="manifest" href="/manifest.webmanifest" />
  <script type="module" src="/assets/index-aaa.js"></script>
  <link rel="stylesheet" href="/assets/index-bbb.css">
</head><body><div id="root"></div></body></html>`;

// ---------- Ambiente falso ----------

const pathOf = (input: unknown) => new URL(typeof input === "string" ? input : (input as { url: string }).url, ORIGIN).pathname;

class FakeCache {
  entries = new Map<string, Response>();
  async match(input: unknown) {
    return this.entries.get(pathOf(input))?.clone();
  }
  async put(input: unknown, response: Response) {
    this.entries.set(pathOf(input), response);
  }
}

class FakeCaches {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

type Handler = (event: never) => void;

function setup() {
  const handlers = new Map<string, Handler>();
  const scope = {
    addEventListener: (type: string, listener: Handler) => void handlers.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: ORIGIN },
  };
  const caches = new FakeCaches();
  // O que a rede devolve por caminho; `offline` simula a rede caindo
  const network = {
    routes: new Map<string, () => Response>([
      ["/", () => new Response(HTML, { status: 200, headers: { "Content-Type": "text/html" } })],
      ["/assets/index-aaa.js", () => new Response("console.log(1)")],
      ["/assets/index-bbb.css", () => new Response("body{}")],
      ["/manifest.webmanifest", () => new Response("{}")],
    ]),
    offline: false,
    calls: [] as string[],
  };
  const fetchFake = vi.fn(async (input: unknown) => {
    const path = pathOf(input);
    network.calls.push(path);
    if (network.offline) throw new TypeError("Failed to fetch");
    const route = network.routes.get(path);
    return route ? route() : new Response("nao achei", { status: 404 });
  });
  registerWorker({ scope: scope as unknown as WorkerScope, caches: caches as unknown as CacheStorage, fetch: fetchFake as unknown as typeof fetch, buildId: BUILD });

  async function waitUntilOf(type: "install" | "activate") {
    let pending: Promise<unknown> = Promise.resolve();
    (handlers.get(type) as (event: unknown) => void)({ waitUntil: (promise: Promise<unknown>) => (pending = promise) });
    return pending;
  }

  function fetchEvent(url: string, { method = "GET", mode = "no-cors" } = {}) {
    let answer: Promise<Response> | Response | undefined;
    const event = { request: { url, method, mode } as unknown as Request, respondWith: (value: Promise<Response> | Response) => (answer = value) };
    (handlers.get("fetch") as (event: unknown) => void)(event);
    return { answered: () => answer !== undefined, response: async () => (await answer) as Response };
  }

  const message = (data: unknown) => (handlers.get("message") as (event: unknown) => void)({ data });
  return { scope, caches, network, fetchFake, waitUntilOf, fetchEvent, message };
}

let env: ReturnType<typeof setup>;
beforeEach(() => {
  env = setup();
});

const stored = (cacheName = CURRENT) => [...(env.caches.stores.get(cacheName)?.entries.keys() ?? [])].sort();

// ---------- Instalar ----------

describe("instalar", () => {
  it("guarda a pagina e tudo o que ela carrega", async () => {
    await env.waitUntilOf("install");
    expect(stored()).toEqual(["/", "/assets/index-aaa.js", "/assets/index-bbb.css", "/manifest.webmanifest"]);
  });

  it("busca sempre da rede, sem usar a copia do navegador", async () => {
    await env.waitUntilOf("install");
    for (const [, init] of env.fetchFake.mock.calls as unknown as [unknown, RequestInit][]) expect(init).toEqual({ cache: "reload" });
  });

  it("a pagina que nao vem faz a instalacao falhar (nao instala worker sem casca)", async () => {
    env.network.routes.set("/", () => new Response("erro", { status: 500 }));
    await expect(env.waitUntilOf("install")).rejects.toThrow("500");
    expect(stored()).toEqual([]);
  });

  it("sem rede na instalacao tambem falha", async () => {
    env.network.offline = true;
    await expect(env.waitUntilOf("install")).rejects.toThrow();
  });

  it("um arquivo que nao veio nao derruba a instalacao nem e guardado", async () => {
    env.network.routes.set("/assets/index-bbb.css", () => new Response("quebrou", { status: 500 }));
    await env.waitUntilOf("install");
    expect(stored()).toEqual(["/", "/assets/index-aaa.js", "/manifest.webmanifest"]);
  });

  it("um arquivo que lanca erro de rede tambem nao derruba a instalacao", async () => {
    env.network.routes.set("/assets/index-aaa.js", () => {
      throw new TypeError("Failed to fetch");
    });
    await env.waitUntilOf("install");
    expect(stored()).toContain("/");
    expect(stored()).not.toContain("/assets/index-aaa.js");
  });
});

// ---------- Ativar ----------

describe("ativar", () => {
  it("apaga os caches de versoes antigas do app e deixa os outros", async () => {
    await env.caches.open(`${CACHE_PREFIX}v1`);
    await env.caches.open(`${CACHE_PREFIX}v0`);
    await env.caches.open(CURRENT);
    await env.caches.open("outro-app");
    await env.waitUntilOf("activate");
    expect(await env.caches.keys()).toEqual([CURRENT, "outro-app"]);
  });

  it("passa a controlar as abas que ja estavam abertas", async () => {
    await env.waitUntilOf("activate");
    expect(env.scope.clients.claim).toHaveBeenCalledTimes(1);
  });
});

// ---------- O que o worker nunca toca ----------

describe("pedidos que o worker deixa para a rede", () => {
  it.each([
    ["a API", `${ORIGIN}/api/v1/transactions`, {}],
    ["a API em navegacao", `${ORIGIN}/api/v1/export.csv`, { mode: "navigate" }],
    ["um POST", `${ORIGIN}/assets/index-aaa.js`, { method: "POST" }],
    ["outro endereco", "https://cdn.example.com/assets/a.js", {}],
    ["o proprio service worker", `${ORIGIN}/sw.js`, {}],
    ["um arquivo que nao e da casca", `${ORIGIN}/dados.json`, {}],
  ])("%s", async (_name, url, options) => {
    await env.waitUntilOf("install");
    const before = env.network.calls.length;
    const event = env.fetchEvent(url, options);
    expect(event.answered()).toBe(false);
    expect(env.network.calls.length).toBe(before);
  });

  it("nunca guarda resposta da API, nem depois de uma sessao inteira de pedidos", async () => {
    await env.waitUntilOf("install");
    for (const path of ["/api/v1/transactions", "/api/v1/accounts", "/api/v1/auth/login"]) env.fetchEvent(`${ORIGIN}${path}`);
    expect(stored().some((path) => path.startsWith("/api"))).toBe(false);
  });
});

// ---------- Abrir uma pagina ----------

describe("abrir uma pagina", () => {
  it("com rede, mostra o que o servidor mandou", async () => {
    env.network.routes.set("/relatorios", () => new Response("do servidor"));
    const event = env.fetchEvent(`${ORIGIN}/relatorios`, { mode: "navigate" });
    expect(await (await event.response()).text()).toBe("do servidor");
  });

  it("sem rede, abre a casca guardada (o React mostra o aviso)", async () => {
    await env.waitUntilOf("install");
    env.network.offline = true;
    const event = env.fetchEvent(`${ORIGIN}/transacoes`, { mode: "navigate" });
    expect(await (await event.response()).text()).toBe(HTML);
  });

  it("sem rede e sem casca guardada, mostra a pagina de sem conexao", async () => {
    env.network.offline = true;
    const response = await env.fetchEvent(`${ORIGIN}/`, { mode: "navigate" }).response();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(OFFLINE_HTML);
  });

  it("a casca de uma versao antiga nao serve para a versao nova", async () => {
    const old = await env.caches.open(`${CACHE_PREFIX}v1`);
    await old.put("/", new Response("casca velha"));
    env.network.offline = true;
    const response = await env.fetchEvent(`${ORIGIN}/`, { mode: "navigate" }).response();
    expect(response.status).toBe(503);
  });
});

// ---------- Arquivos da casca ----------

describe("arquivos da casca", () => {
  it("o que ja esta guardado sai do cache, sem ir a rede", async () => {
    await env.waitUntilOf("install");
    env.network.calls.length = 0;
    const response = await env.fetchEvent(`${ORIGIN}/assets/index-aaa.js`).response();
    expect(await response.text()).toBe("console.log(1)");
    expect(env.network.calls).toEqual([]);
  });

  it("o que falta vem da rede e fica guardado para a proxima", async () => {
    env.network.routes.set("/icons/icon-192.png", () => new Response("png"));
    const first = await env.fetchEvent(`${ORIGIN}/icons/icon-192.png`).response();
    expect(await first.text()).toBe("png");
    expect(stored()).toEqual(["/icons/icon-192.png"]);
    env.network.offline = true;
    const second = await env.fetchEvent(`${ORIGIN}/icons/icon-192.png`).response();
    expect(await second.text()).toBe("png");
  });

  it("resposta com erro nao e guardada", async () => {
    env.network.routes.set("/assets/quebrado.js", () => new Response("erro", { status: 500 }));
    const response = await env.fetchEvent(`${ORIGIN}/assets/quebrado.js`).response();
    expect(response.status).toBe(500);
    expect(stored()).toEqual([]);
  });

  it("sem rede e sem copia guardada, falha (nao inventa resposta)", async () => {
    env.network.offline = true;
    await expect(env.fetchEvent(`${ORIGIN}/assets/novo.js`).response()).rejects.toThrow();
  });
});

// ---------- Atualizar ----------

describe("mensagens", () => {
  it("SKIP_WAITING deixa a versao nova assumir", () => {
    env.message({ type: "SKIP_WAITING" });
    expect(env.scope.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it.each([[{ type: "OUTRA" }], [{}], [undefined], ["SKIP_WAITING"], [null]])("%j nao faz nada", (data) => {
    env.message(data);
    expect(env.scope.skipWaiting).not.toHaveBeenCalled();
  });

  it("a instalacao nao assume sozinha: a versao nova espera a pessoa aceitar", async () => {
    await env.waitUntilOf("install");
    expect(env.scope.skipWaiting).not.toHaveBeenCalled();
  });
});
