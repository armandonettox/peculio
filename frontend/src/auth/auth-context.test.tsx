import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "@/api/client";
import { ApiError } from "@/api/errors";
import { sampleUser, server } from "@/test-utils/msw";
import { AuthProvider, REFRESH_INTERVAL_MS, useAuth } from "./auth-context";
import { createTokenStore } from "./token-store";

function setup() {
  const tokenStore = createTokenStore();
  const api = createApiClient({ tokenStore });
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider api={api} tokenStore={tokenStore}>
        {children}
      </AuthProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useAuth(), { wrapper });
  return { ...hook, tokenStore, queryClient, api };
}

const loginOk = () => http.post("*/api/v1/auth/login", () => HttpResponse.json({ access_token: "tok", token_type: "bearer" }));
const twoFactorLogin = () =>
  http.post("*/api/v1/auth/login", () =>
    HttpResponse.json({ access_token: null, two_factor_required: true, challenge_token: "desafio" }),
  );
const meOk = () => http.get("*/api/v1/auth/me", () => HttpResponse.json(sampleUser));

afterEach(() => vi.useRealTimers());

describe("login", () => {
  it("comeca sem usuario", () => {
    const { result } = setup();
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("guarda o token, carrega o usuario e marca como autenticado", async () => {
    server.use(loginOk(), meOk());
    const { result, tokenStore } = setup();

    await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }));

    expect(tokenStore.get()).toBe("tok");
    expect(result.current.user).toEqual(sampleUser);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("credenciais erradas lancam ApiError e nao deixam sessao", async () => {
    server.use(
      http.post("*/api/v1/auth/login", () =>
        HttpResponse.json({ detail: "Email ou senha invalidos", code: "invalid_credentials" }, { status: 401 }),
      ),
    );
    const { result, tokenStore } = setup();

    const error = await act(() =>
      result.current.login({ email: "ana@example.com", password: "errada" }).catch((e) => e),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("invalid_credentials");
    expect(tokenStore.get()).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("sem 2FA devolve status ok", async () => {
    server.use(loginOk(), meOk());
    const { result } = setup();
    const outcome = await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }));
    expect(outcome).toEqual({ status: "ok" });
  });

  it("conta com 2FA devolve so o desafio: nao vira sessao", async () => {
    server.use(twoFactorLogin());
    const { result, tokenStore } = setup();

    const outcome = await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }));

    expect(outcome).toEqual({ status: "two_factor", challengeToken: "desafio" });
    expect(tokenStore.get()).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("verifyTwoFactor manda o desafio e o codigo e abre a sessao", async () => {
    let sent: unknown;
    server.use(
      meOk(),
      http.post("*/api/v1/auth/2fa/verify", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ access_token: "tok2", token_type: "bearer" });
      }),
    );
    const { result, tokenStore } = setup();

    await act(() => result.current.verifyTwoFactor("desafio", "123456"));

    expect(sent).toEqual({ challenge_token: "desafio", code: "123456", remember: false });
    expect(tokenStore.get()).toBe("tok2");
    expect(result.current.user).toEqual(sampleUser);
  });

  it("codigo errado lanca ApiError e nao deixa sessao", async () => {
    server.use(
      http.post("*/api/v1/auth/2fa/verify", () =>
        HttpResponse.json({ detail: "x", code: "two_factor_invalid_code" }, { status: 401 }),
      ),
    );
    const { result, tokenStore } = setup();

    const error = await act(() => result.current.verifyTwoFactor("desafio", "000000").catch((e) => e));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("two_factor_invalid_code");
    expect(tokenStore.get()).toBeNull();
  });

  it("verifyTwoFactor desfaz a sessao se nao conseguir carregar o usuario", async () => {
    server.use(
      http.post("*/api/v1/auth/2fa/verify", () => HttpResponse.json({ access_token: "tok2", token_type: "bearer" })),
      http.get("*/api/v1/auth/me", () => HttpResponse.json({ detail: "x", code: "internal_error" }, { status: 500 })),
    );
    const { result, tokenStore } = setup();

    await act(() => result.current.verifyTwoFactor("desafio", "123456").catch(() => undefined));

    expect(tokenStore.get()).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("se nao conseguir carregar o usuario, desfaz o login", async () => {
    server.use(
      loginOk(),
      http.get("*/api/v1/auth/me", () => HttpResponse.json({ detail: "x", code: "internal_error" }, { status: 500 })),
    );
    const { result, tokenStore } = setup();

    await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }).catch(() => undefined));

    expect(tokenStore.get()).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });
});

describe("register", () => {
  it("cria a conta e ja entra", async () => {
    let registered: unknown;
    server.use(
      http.post("*/api/v1/auth/register", async ({ request }) => {
        registered = await request.json();
        return HttpResponse.json(sampleUser, { status: 201 });
      }),
      loginOk(),
      meOk(),
    );
    const { result } = setup();

    await act(() =>
      result.current.register({ name: "Ana", email: "ana@example.com", password: "SenhaForte123", inviteToken: "conv" }),
    );

    expect(registered).toEqual({ name: "Ana", email: "ana@example.com", password: "SenhaForte123", invite_token: "conv" });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("sem convite envia invite_token nulo (primeiro usuario)", async () => {
    let registered: Record<string, unknown> = {};
    server.use(
      http.post("*/api/v1/auth/register", async ({ request }) => {
        registered = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sampleUser, { status: 201 });
      }),
      loginOk(),
      meOk(),
    );
    const { result } = setup();

    await act(() => result.current.register({ name: "Ana", email: "ana@example.com", password: "SenhaForte123" }));

    expect(registered.invite_token).toBeNull();
  });

  it("erro no cadastro nao tenta entrar", async () => {
    let loginCalls = 0;
    server.use(
      http.post("*/api/v1/auth/register", () =>
        HttpResponse.json({ detail: "x", code: "invite_required" }, { status: 403 }),
      ),
      http.post("*/api/v1/auth/login", () => {
        loginCalls += 1;
        return HttpResponse.json({ access_token: "tok", token_type: "bearer" });
      }),
    );
    const { result } = setup();

    const error = await act(() =>
      result.current.register({ name: "Ana", email: "ana@example.com", password: "SenhaForte123" }).catch((e) => e),
    );

    expect(error.code).toBe("invite_required");
    expect(loginCalls).toBe(0);
  });
});

describe("logout e fim de sessao", () => {
  it("logout limpa token, usuario e o cache de dados", async () => {
    server.use(loginOk(), meOk());
    const { result, tokenStore, queryClient } = setup();
    await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }));
    queryClient.setQueryData(["dados-do-usuario"], { saldo: 100 });

    await act(() => result.current.logout());

    expect(tokenStore.get()).toBeNull();
    expect(result.current.user).toBeNull();
    expect(queryClient.getQueryData(["dados-do-usuario"])).toBeUndefined();
  });

  it("quando a renovacao falha a sessao acaba sozinha", async () => {
    server.use(
      loginOk(),
      meOk(),
      http.post("*/api/v1/auth/refresh", () =>
        HttpResponse.json({ detail: "x", code: "session_expired" }, { status: 401 }),
      ),
    );
    const { result, api } = setup();
    await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }));
    expect(result.current.isAuthenticated).toBe(true);

    await act(() => api.refreshAccessToken());

    await waitFor(() => expect(result.current.isAuthenticated).toBe(false));
  });
});

describe("renovacao periodica", () => {
  function setupWithFakeApi() {
    const tokenStore = createTokenStore();
    const ok = { response: new Response(null, { status: 200 }) };
    const refreshAccessToken = vi.fn().mockResolvedValue(true);
    const api = {
      client: {
        POST: vi.fn().mockResolvedValue({ ...ok, data: { access_token: "tok" } }),
        GET: vi.fn().mockResolvedValue({ ...ok, data: sampleUser }),
      },
      refreshAccessToken,
      restoreSession: vi.fn().mockResolvedValue(null),
      endSession: vi.fn().mockResolvedValue(true),
    } as unknown as ReturnType<typeof createApiClient>;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider api={api} tokenStore={tokenStore}>
          {children}
        </AuthProvider>
      </QueryClientProvider>
    );
    return { ...renderHook(() => useAuth(), { wrapper }), refreshAccessToken };
  }

  it("renova a cada 20 minutos enquanto autenticado", async () => {
    vi.useFakeTimers();
    const { result, refreshAccessToken } = setupWithFakeApi();
    await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }));

    act(() => vi.advanceTimersByTime(REFRESH_INTERVAL_MS));
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(REFRESH_INTERVAL_MS));
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it("nao renova quando ninguem esta logado", () => {
    vi.useFakeTimers();
    const { refreshAccessToken } = setupWithFakeApi();
    act(() => vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 3));
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("renova ao voltar para a aba", async () => {
    vi.useFakeTimers();
    const { result, refreshAccessToken } = setupWithFakeApi();
    await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }));

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("para de renovar depois do logout", async () => {
    vi.useFakeTimers();
    const { result, refreshAccessToken } = setupWithFakeApi();
    await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }));
    await act(() => result.current.logout());

    act(() => vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 2));

    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});

it("useAuth fora do AuthProvider lanca erro claro", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(() => renderHook(() => useAuth())).toThrow("AuthProvider");
  spy.mockRestore();
});

describe("sessao guardada ao abrir o app", () => {
  const restoreOk = (token = "restaurado") =>
    http.post("*/api/v1/auth/session", () => HttpResponse.json({ access_token: token, token_type: "bearer" }));

  it("comeca conferindo: ainda nao sabe se ha sessao", () => {
    const { result } = setup();
    expect(result.current.isRestoring).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("com cookie valido entra sem pedir senha: guarda o token e carrega o usuario", async () => {
    server.use(restoreOk(), meOk());
    const { result, tokenStore } = setup();
    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    expect(tokenStore.get()).toBe("restaurado");
    expect(result.current.user).toEqual(sampleUser);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("sem sessao guardada termina de conferir e segue sem usuario", async () => {
    const { result, tokenStore } = setup();
    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(tokenStore.get()).toBeNull();
  });

  it("se o cookie vale mas nao da para carregar o usuario, nao fica sessao pela metade", async () => {
    server.use(
      restoreOk(),
      http.get("*/api/v1/auth/me", () => HttpResponse.json({ detail: "x", code: "token_invalid" }, { status: 401 })),
      http.post("*/api/v1/auth/refresh", () => HttpResponse.json({ detail: "x", code: "token_invalid" }, { status: 401 })),
    );
    const { result, tokenStore } = setup();
    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(tokenStore.get()).toBeNull();
  });
});

describe("manter conectado e sair", () => {
  it("login manda remember falso por padrao e verdadeiro quando pedido", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("*/api/v1/auth/login", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ access_token: "tok", token_type: "bearer" });
      }),
      meOk(),
    );
    const { result } = setup();
    await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }));
    await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123", remember: true }));
    expect(bodies).toEqual([
      { email: "ana@example.com", password: "SenhaForte123", remember: false },
      { email: "ana@example.com", password: "SenhaForte123", remember: true },
    ]);
  });

  it("verifyTwoFactor leva o remember do primeiro passo", async () => {
    let sent: unknown;
    server.use(
      http.post("*/api/v1/auth/2fa/verify", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ access_token: "tok", token_type: "bearer" });
      }),
      meOk(),
    );
    const { result } = setup();
    await act(() => result.current.verifyTwoFactor("desafio", "123456", true));
    expect(sent).toEqual({ challenge_token: "desafio", code: "123456", remember: true });
  });

  it("logout avisa o servidor com o token e o cabecalho do app antes de limpar a aba", async () => {
    let auth: string | null = null;
    let header: string | null = null;
    server.use(
      loginOk(),
      meOk(),
      http.post("*/api/v1/auth/logout", ({ request }) => {
        auth = request.headers.get("authorization");
        header = request.headers.get("x-requested-with");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result, tokenStore } = setup();
    await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }));
    await act(() => result.current.logout());
    expect(auth).toBe("Bearer tok");
    expect(header).toBe("peculio");
    expect(tokenStore.get()).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("sem rede o logout sai desta aba do mesmo jeito", async () => {
    server.use(loginOk(), meOk(), http.post("*/api/v1/auth/logout", () => HttpResponse.error()));
    const { result, tokenStore } = setup();
    await act(() => result.current.login({ email: "ana@example.com", password: "SenhaForte123" }));
    await act(() => result.current.logout());
    expect(tokenStore.get()).toBeNull();
    expect(result.current.user).toBeNull();
  });
});
