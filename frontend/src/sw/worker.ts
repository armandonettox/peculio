import {
  cacheNameFor,
  classifyRequest,
  isCacheable,
  offlineHtmlFor,
  shellAssetsFromHtml,
  SHELL_URL,
  staleCaches,
} from "./rules";

// O service worker com tudo injetado (escopo, caches, fetch): assim os testes montam um escopo falso e conferem o que
// ele faz em cada evento, sem navegador. O arquivo sw.ts so liga isto aos globais de verdade.

type ExtendEvent = { waitUntil(promise: Promise<unknown>): void };
type FetchEvt = ExtendEvent & { request: Request; respondWith(response: Promise<Response> | Response): void };
type MessageEvt = { data?: unknown };

export type WorkerScope = {
  addEventListener(type: "install" | "activate", listener: (event: ExtendEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvt) => void): void;
  addEventListener(type: "message", listener: (event: MessageEvt) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  location: { origin: string };
};

export type WorkerDeps = {
  scope: WorkerScope;
  caches: CacheStorage;
  fetch: typeof fetch;
  // Identifica a versao do app: muda quando o app muda, e com ela o nome do cache
  buildId: string;
};

export function registerWorker({ scope, caches, fetch, buildId }: WorkerDeps): void {
  const cacheName = cacheNameFor(buildId);

  // Instala: guarda a casca (a pagina e o que ela carrega) para o app abrir sem rede. Se a pagina nao vier, a
  // instalacao falha e o navegador tenta de novo depois, em vez de instalar um worker sem casca.
  async function precache(): Promise<void> {
    const cache = await caches.open(cacheName);
    const page = await fetch(SHELL_URL, { cache: "reload" });
    if (!page.ok) throw new Error(`A pagina inicial respondeu ${page.status}`);
    const html = await page.clone().text();
    await cache.put(SHELL_URL, page);
    await Promise.all(
      shellAssetsFromHtml(html).map(async (path) => {
        try {
          const response = await fetch(path, { cache: "reload" });
          if (isCacheable(response)) await cache.put(path, response);
        } catch {
          // Um arquivo que nao veio agora entra no cache na primeira vez que a pagina pedir
        }
      }),
    );
  }

  // Ativa: apaga os caches das versoes antigas e passa a controlar as abas que ja estavam abertas
  async function activate(): Promise<void> {
    const names = await caches.keys();
    await Promise.all(staleCaches(names, cacheName).map((name) => caches.delete(name)));
    await scope.clients.claim();
  }

  // Abrir uma pagina: rede primeiro. Sem rede, a casca guardada (o React abre e mostra o aviso de sem conexao).
  async function navigate(request: Request): Promise<Response> {
    try {
      return await fetch(request);
    } catch {
      const cached = await (await caches.open(cacheName)).match(SHELL_URL);
      if (cached) return cached;
      const html = offlineHtmlFor(request.headers.get("Accept-Language"));
      return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  }

  // Arquivo da casca: o guardado primeiro (o nome tem hash, entao nunca fica velho); o que faltar vem da rede e e guardado
  async function fromCacheFirst(request: Request): Promise<Response> {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(request, response.clone());
    return response;
  }

  scope.addEventListener("install", (event) => event.waitUntil(precache()));
  scope.addEventListener("activate", (event) => event.waitUntil(activate()));

  scope.addEventListener("fetch", (event) => {
    const strategy = classifyRequest(
      { url: event.request.url, method: event.request.method, mode: event.request.mode },
      scope.location.origin,
    );
    // Nao responder e deixar o navegador seguir direto para a rede: e o que a API e tudo o mais devem fazer
    if (strategy === "ignore") return;
    event.respondWith(strategy === "navigate" ? navigate(event.request) : fromCacheFirst(event.request));
  });

  // A versao nova espera ate a pessoa aceitar (botao Atualizar): so entao assume o lugar da antiga
  scope.addEventListener("message", (event) => {
    const data = event.data as { type?: string } | undefined;
    if (data?.type === "SKIP_WAITING") void scope.skipWaiting();
  });
}
