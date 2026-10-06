import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { createTokenStore } from "@/auth/token-store";
import { sampleUser, server } from "@/test-utils/msw";
import { createApiClient, unwrap } from "./client";
import { ApiError } from "./errors";

const unauthorized = () =>
  HttpResponse.json({ detail: "Token invalido", code: "token_invalid" }, { status: 401 });

function setup(initialToken: string | null = "old") {
  const tokenStore = createTokenStore();
  if (initialToken) tokenStore.set(initialToken);
  const api = createApiClient({ tokenStore });
  return { tokenStore, api };
}

describe("token nos pedidos", () => {
  it("envia o token no cabecalho Authorization", async () => {
    let received: string | null = null;
    server.use(
      http.get("*/api/v1/auth/me", ({ request }) => {
        received = request.headers.get("authorization");
        return HttpResponse.json(sampleUser);
      }),
    );
    const { api } = setup("meu-token");
    await unwrap(api.client.GET("/api/v1/auth/me"));
    expect(received).toBe("Bearer meu-token");
  });

  it("nao envia cabecalho quando nao ha token", async () => {
    let received: string | null = "x";
    server.use(
      http.get("*/api/v1/auth/me", ({ request }) => {
        received = request.headers.get("authorization");
        return HttpResponse.json(sampleUser);
      }),
    );
    const { api } = setup(null);
    await unwrap(api.client.GET("/api/v1/auth/me"));
    expect(received).toBeNull();
  });
});

describe("unwrap", () => {
  it("devolve os dados quando da certo", async () => {
    server.use(http.get("*/api/v1/auth/me", () => HttpResponse.json(sampleUser)));
    const { api } = setup();
    expect(await unwrap(api.client.GET("/api/v1/auth/me"))).toEqual(sampleUser);
  });

  it("lanca ApiError com o codigo do backend", async () => {
    server.use(
      http.post("*/api/v1/auth/login", () =>
        HttpResponse.json({ detail: "Email ou senha invalidos", code: "invalid_credentials" }, { status: 401 }),
      ),
    );
    const { api } = setup(null);
    const error = await unwrap(
      api.client.POST("/api/v1/auth/login", { body: { email: "a@example.com", password: "x", remember: false } }),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe("invalid_credentials");
  });

  it("traz os erros por campo do 422", async () => {
    server.use(
      http.post("*/api/v1/auth/register", () =>
        HttpResponse.json(
          {
            detail: "Dados invalidos",
            code: "validation_error",
            errors: [{ field: "password", message: "Senha deve ter pelo menos 8 caracteres" }],
          },
          { status: 422 },
        ),
      ),
    );
    const { api } = setup(null);
    const error = await unwrap(
      api.client.POST("/api/v1/auth/register", { body: { name: "A", email: "a@example.com", password: "x" } }),
    ).catch((e) => e);
    expect(error.code).toBe("validation_error");
    expect(error.fieldErrors).toEqual([{ field: "password", message: "Senha deve ter pelo menos 8 caracteres" }]);
  });

  it("transforma falha de rede em ApiError network_error", async () => {
    server.use(http.get("*/api/v1/auth/me", () => HttpResponse.error()));
    const { api } = setup();
    const error = await unwrap(api.client.GET("/api/v1/auth/me")).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("network_error");
  });

  it("aguenta resposta 204 sem corpo", async () => {
    server.use(http.delete("*/api/v1/invites/:id", () => new HttpResponse(null, { status: 204 })));
    const { api } = setup();
    await expect(
      unwrap(api.client.DELETE("/api/v1/invites/{invite_id}", { params: { path: { invite_id: "x" } } })),
    ).resolves.toBeUndefined();
  });
});

describe("renovacao automatica no 401", () => {
  it("renova o token e repete o pedido, com o corpo original", async () => {
    const bodies: unknown[] = [];
    const auths: (string | null)[] = [];
    server.use(
      http.post("*/api/v1/invites", async ({ request }) => {
        auths.push(request.headers.get("authorization"));
        bodies.push(await request.json());
        if (request.headers.get("authorization") === "Bearer old") return unauthorized();
        return HttpResponse.json(
          { id: "i", email: "novo@example.com", expires_at: "2026-10-01T00:00:00Z", used_at: null, created_at: "2026-09-30T00:00:00Z", token: "t" },
          { status: 201 },
        );
      }),
      http.post("*/api/v1/auth/refresh", () => HttpResponse.json({ access_token: "new", token_type: "bearer" })),
    );
    const { api, tokenStore } = setup("old");

    const result = await unwrap(api.client.POST("/api/v1/invites", { body: { email: "novo@example.com" } }));

    expect(result.token).toBe("t");
    expect(auths).toEqual(["Bearer old", "Bearer new"]);
    expect(bodies).toEqual([{ email: "novo@example.com" }, { email: "novo@example.com" }]);
    expect(tokenStore.get()).toBe("new");
  });

  it("pedidos simultaneos com 401 compartilham uma unica renovacao", async () => {
    let refreshCalls = 0;
    server.use(
      http.get("*/api/v1/auth/me", ({ request }) =>
        request.headers.get("authorization") === "Bearer old" ? unauthorized() : HttpResponse.json(sampleUser),
      ),
      http.post("*/api/v1/auth/refresh", async () => {
        refreshCalls += 1;
        await delay(30);
        return HttpResponse.json({ access_token: "new", token_type: "bearer" });
      }),
    );
    const { api } = setup("old");

    const results = await Promise.all([
      unwrap(api.client.GET("/api/v1/auth/me")),
      unwrap(api.client.GET("/api/v1/auth/me")),
      unwrap(api.client.GET("/api/v1/auth/me")),
    ]);

    expect(results).toHaveLength(3);
    expect(refreshCalls).toBe(1);
  });

  it("se a renovacao falhar, limpa o token e devolve o erro original", async () => {
    server.use(
      http.get("*/api/v1/auth/me", () => unauthorized()),
      http.post("*/api/v1/auth/refresh", () =>
        HttpResponse.json({ detail: "Sessao expirada", code: "session_expired" }, { status: 401 }),
      ),
    );
    const { api, tokenStore } = setup("old");

    const error = await unwrap(api.client.GET("/api/v1/auth/me")).catch((e) => e);

    expect(error.status).toBe(401);
    expect(tokenStore.get()).toBeNull();
  });

  it("se o pedido repetido tambem der 401, nao entra em loop", async () => {
    let refreshCalls = 0;
    let meCalls = 0;
    server.use(
      http.get("*/api/v1/auth/me", () => {
        meCalls += 1;
        return unauthorized();
      }),
      http.post("*/api/v1/auth/refresh", () => {
        refreshCalls += 1;
        return HttpResponse.json({ access_token: "new", token_type: "bearer" });
      }),
    );
    const { api } = setup("old");

    const error = await unwrap(api.client.GET("/api/v1/auth/me")).catch((e) => e);

    expect(error.status).toBe(401);
    expect(refreshCalls).toBe(1);
    expect(meCalls).toBe(2);
  });

  it("401 no login nao tenta renovar (senha errada nao e sessao vencida)", async () => {
    let refreshCalls = 0;
    server.use(
      http.post("*/api/v1/auth/login", () =>
        HttpResponse.json({ detail: "x", code: "invalid_credentials" }, { status: 401 }),
      ),
      http.post("*/api/v1/auth/refresh", () => {
        refreshCalls += 1;
        return HttpResponse.json({ access_token: "new", token_type: "bearer" });
      }),
    );
    const { api, tokenStore } = setup("old");

    await unwrap(
      api.client.POST("/api/v1/auth/login", { body: { email: "a@example.com", password: "x", remember: false } }),
    ).catch(() => undefined);

    expect(refreshCalls).toBe(0);
    expect(tokenStore.get()).toBe("old");
  });

  it("sem token nao tenta renovar", async () => {
    let refreshCalls = 0;
    server.use(
      http.get("*/api/v1/auth/me", () =>
        HttpResponse.json({ detail: "Token ausente", code: "token_missing" }, { status: 401 }),
      ),
      http.post("*/api/v1/auth/refresh", () => {
        refreshCalls += 1;
        return HttpResponse.json({ access_token: "new", token_type: "bearer" });
      }),
    );
    const { api } = setup(null);

    const error = await unwrap(api.client.GET("/api/v1/auth/me")).catch((e) => e);

    expect(error.code).toBe("token_missing");
    expect(refreshCalls).toBe(0);
  });

  it("falha de rede na renovacao mantem o token para tentar depois", async () => {
    server.use(
      http.get("*/api/v1/auth/me", () => unauthorized()),
      http.post("*/api/v1/auth/refresh", () => HttpResponse.error()),
    );
    const { api, tokenStore } = setup("old");

    await unwrap(api.client.GET("/api/v1/auth/me")).catch(() => undefined);

    expect(tokenStore.get()).toBe("old");
  });

  it("refreshAccessToken sem token devolve false sem chamar a API", async () => {
    const { api } = setup(null);
    expect(await api.refreshAccessToken()).toBe(false);
  });

  it("refreshAccessToken troca o token guardado", async () => {
    server.use(http.post("*/api/v1/auth/refresh", () => HttpResponse.json({ access_token: "novo", token_type: "bearer" })));
    const { api, tokenStore } = setup("old");
    expect(await api.refreshAccessToken()).toBe(true);
    expect(tokenStore.get()).toBe("novo");
  });
});

describe("sessao guardada (cookie de renovacao)", () => {
  const sessionOk = (token = "restaurado") =>
    http.post("*/api/v1/auth/session", () => HttpResponse.json({ access_token: token, token_type: "bearer" }));

  it("restoreSession troca o cookie por um token e manda o cabecalho do app", async () => {
    let header: string | null = null;
    server.use(
      http.post("*/api/v1/auth/session", ({ request }) => {
        header = request.headers.get("x-requested-with");
        return HttpResponse.json({ access_token: "restaurado", token_type: "bearer" });
      }),
    );
    const { api } = setup(null);
    expect(await api.restoreSession()).toBe("restaurado");
    expect(header).toBe("peculio");
  });

  it("restoreSession devolve null quando nao ha sessao (401) ou o servidor nao responde", async () => {
    const { api } = setup(null);
    expect(await api.restoreSession()).toBeNull();
    server.use(http.post("*/api/v1/auth/session", () => HttpResponse.error()));
    expect(await api.restoreSession()).toBeNull();
  });

  it("restoreSession nao mexe no token guardado: quem decide e o chamador", async () => {
    server.use(sessionOk());
    const { api, tokenStore } = setup("antigo");
    await api.restoreSession();
    expect(tokenStore.get()).toBe("antigo");
  });

  it("endSession avisa o servidor com o token e o cabecalho do app", async () => {
    let auth: string | null = null;
    let header: string | null = null;
    server.use(
      http.post("*/api/v1/auth/logout", ({ request }) => {
        auth = request.headers.get("authorization");
        header = request.headers.get("x-requested-with");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { api } = setup("meu-token");
    expect(await api.endSession()).toBe(true);
    expect(auth).toBe("Bearer meu-token");
    expect(header).toBe("peculio");
  });

  it("endSession sem token manda so o cabecalho do app (o cookie basta)", async () => {
    let auth: string | null = "x";
    server.use(
      http.post("*/api/v1/auth/logout", ({ request }) => {
        auth = request.headers.get("authorization");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { api } = setup(null);
    expect(await api.endSession()).toBe(true);
    expect(auth).toBeNull();
  });

  it("endSession devolve false quando o servidor recusa ou nao responde", async () => {
    const { api } = setup("t");
    server.use(http.post("*/api/v1/auth/logout", () => HttpResponse.json({ detail: "x", code: "client_header_missing" }, { status: 403 })));
    expect(await api.endSession()).toBe(false);
    server.use(http.post("*/api/v1/auth/logout", () => HttpResponse.error()));
    expect(await api.endSession()).toBe(false);
  });

  it("se o token nao renova mas o cookie ainda vale, a sessao continua com o token novo", async () => {
    server.use(http.post("*/api/v1/auth/refresh", () => unauthorized()), sessionOk("pelo-cookie"));
    const { api, tokenStore } = setup("velho");
    expect(await api.refreshAccessToken()).toBe(true);
    expect(tokenStore.get()).toBe("pelo-cookie");
  });

  it("se nem o cookie vale, a sessao acaba", async () => {
    server.use(http.post("*/api/v1/auth/refresh", () => unauthorized()));
    const { api, tokenStore } = setup("velho");
    expect(await api.refreshAccessToken()).toBe(false);
    expect(tokenStore.get()).toBeNull();
  });

  it("um pedido que toma 401 e repetido com o token vindo do cookie", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/v1/auth/me", ({ request }) => {
        calls += 1;
        return request.headers.get("authorization") === "Bearer pelo-cookie" ? HttpResponse.json(sampleUser) : unauthorized();
      }),
      http.post("*/api/v1/auth/refresh", () => unauthorized()),
      sessionOk("pelo-cookie"),
    );
    const { api, tokenStore } = setup("velho");
    expect(await unwrap(api.client.GET("/api/v1/auth/me"))).toEqual(sampleUser);
    expect(calls).toBe(2);
    expect(tokenStore.get()).toBe("pelo-cookie");
  });
});
