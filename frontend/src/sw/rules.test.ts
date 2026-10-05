import { describe, expect, it } from "vitest";

import {
  CACHE_PREFIX,
  cacheNameFor,
  classifyRequest,
  isApiPath,
  isCacheable,
  isStaticPath,
  OFFLINE_HTML,
  shellAssetsFromHtml,
  staleCaches,
} from "./rules";

const ORIGIN = "https://app.test";
const get = (path: string, mode = "no-cors") => ({ url: `${ORIGIN}${path}`, method: "GET", mode });

describe("classifyRequest", () => {
  it.each([
    ["/assets/index-abc123.js", "static"],
    ["/assets/index-abc123.css", "static"],
    ["/icons/icon-192.png", "static"],
    ["/manifest.webmanifest", "static"],
    ["/favicon.svg", "static"],
  ])("arquivo da casca %s", (path, expected) => expect(classifyRequest(get(path), ORIGIN)).toBe(expected));

  it.each([
    ["/api/v1/transactions"],
    ["/api/v1/auth/login"],
    ["/api/v1/reports/summary?period=this-month"],
    ["/api"],
    ["/api/"],
  ])("a API nunca passa pelo cache: %s", (path) => {
    expect(classifyRequest(get(path), ORIGIN)).toBe("ignore");
    expect(classifyRequest(get(path, "navigate"), ORIGIN)).toBe("ignore");
  });

  it.each(["/", "/transacoes", "/relatorios?aba=personalizado", "/contas/123"])("abrir a pagina %s e navegacao", (path) => {
    expect(classifyRequest(get(path, "navigate"), ORIGIN)).toBe("navigate");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])("%s nunca e do cache", (method) => {
    expect(classifyRequest({ url: `${ORIGIN}/assets/a.js`, method, mode: "cors" }, ORIGIN)).toBe("ignore");
    expect(classifyRequest({ url: `${ORIGIN}/api/v1/transactions`, method, mode: "cors" }, ORIGIN)).toBe("ignore");
  });

  it("outro endereco nao e da casca", () => {
    expect(classifyRequest({ url: "https://cdn.example.com/assets/a.js", method: "GET", mode: "cors" }, ORIGIN)).toBe("ignore");
    expect(classifyRequest({ url: "https://app.test:8443/assets/a.js", method: "GET", mode: "cors" }, ORIGIN)).toBe("ignore");
    expect(classifyRequest({ url: "http://app.test/assets/a.js", method: "GET", mode: "cors" }, ORIGIN)).toBe("ignore");
  });

  it("o proprio service worker vem sempre da rede", () => {
    expect(classifyRequest(get("/sw.js"), ORIGIN)).toBe("ignore");
  });

  it("o que nao e da casca nem navegacao vai para a rede", () => {
    expect(classifyRequest(get("/algum-dado.json"), ORIGIN)).toBe("ignore");
    expect(classifyRequest(get("/assets"), ORIGIN)).toBe("ignore");
  });

  it("endereco invalido e ignorado", () => {
    expect(classifyRequest({ url: "not a url", method: "GET", mode: "cors" }, ORIGIN)).toBe("ignore");
  });
});

describe("caminhos", () => {
  it.each([
    ["/assets/x.js", true],
    ["/icons/x.png", true],
    ["/manifest.webmanifest", true],
    ["/favicon.svg", true],
    ["/", false],
    ["/assetsx", false],
    ["/icons", false],
    ["/api/assets/x.js", false],
    ["/sw.js", false],
  ])("estatico %s", (path, expected) => expect(isStaticPath(path)).toBe(expected));

  it.each([
    ["/api", true],
    ["/api/v1/x", true],
    ["/apix", false],
    ["/v1/api", false],
    ["/", false],
  ])("api %s", (path, expected) => expect(isApiPath(path)).toBe(expected));
});

describe("nomes de cache", () => {
  it("leva a versao", () => expect(cacheNameFor("abc123")).toBe(`${CACHE_PREFIX}abc123`));

  it("so os caches antigos do app sao apagados", () => {
    const names = [`${CACHE_PREFIX}old1`, `${CACHE_PREFIX}new`, `${CACHE_PREFIX}old2`, "outro-app-v1", "workbox-precache", ""];
    expect(staleCaches(names, `${CACHE_PREFIX}new`)).toEqual([`${CACHE_PREFIX}old1`, `${CACHE_PREFIX}old2`]);
  });

  it("sem caches antigos, nada a apagar", () => {
    expect(staleCaches([`${CACHE_PREFIX}new`], `${CACHE_PREFIX}new`)).toEqual([]);
    expect(staleCaches([], `${CACHE_PREFIX}new`)).toEqual([]);
  });
});

describe("isCacheable", () => {
  it.each([
    [200, "basic", true],
    [200, "default", true],
    [200, "cors", false],
    [200, "opaque", false],
    [200, "opaqueredirect", false],
    [304, "basic", false],
    [404, "basic", false],
    [500, "basic", false],
    [206, "basic", false],
  ])("status %i tipo %s", (status, type, expected) => expect(isCacheable({ status, type })).toBe(expected));
});

describe("shellAssetsFromHtml", () => {
  const html = `<!doctype html><html><head>
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" href="/icons/favicon-32.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <script type="module" crossorigin src="/assets/index-AbC123.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-XyZ789.css">
    <link rel="stylesheet" href="https://fonts.example.com/inter.css">
    <a href="/transacoes">fora</a>
    <script src="/assets/index-AbC123.js"></script>
  </head></html>`;

  it("acha os arquivos da casca, sem repetir", () => {
    expect(shellAssetsFromHtml(html).sort()).toEqual(
      [
        "/assets/index-AbC123.js",
        "/assets/index-XyZ789.css",
        "/favicon.svg",
        "/icons/apple-touch-icon.png",
        "/icons/favicon-32.png",
        "/manifest.webmanifest",
      ].sort(),
    );
  });

  it("ignora outro endereco, rotas do app e a API", () => {
    const found = shellAssetsFromHtml(`<a href="/api/v1/x">x</a><a href="https://x.com/assets/a.js">y</a><a href="/relatorios">z</a>`);
    expect(found).toEqual([]);
  });

  it("tira o que vem depois de ? ou #", () => {
    expect(shellAssetsFromHtml(`<script src="/assets/a.js?v=2"></script><link href="/icons/i.png#x">`)).toEqual([]);
  });

  it("html sem arquivos da casca", () => {
    expect(shellAssetsFromHtml("<html></html>")).toEqual([]);
  });
});

describe("pagina de sem conexao", () => {
  it("avisa em portugues e tem o botao de tentar de novo", () => {
    expect(OFFLINE_HTML).toContain("Sem conexão");
    expect(OFFLINE_HTML).toContain("Tentar de novo");
    expect(OFFLINE_HTML).toContain('lang="pt-BR"');
  });
});
