import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api as defaultApi, unwrap } from "@/api/client";
import { ApiError } from "@/api/errors";
import type { components } from "@/api/schema";
import { tokenStore as defaultTokenStore, type TokenStore } from "./token-store";

export type User = components["schemas"]["UserOut"];
type Api = typeof defaultApi;

export type LoginResult = { status: "ok" } | { status: "two_factor"; challengeToken: string };

type Credentials ={ email: string; password: string };
type RegisterInput = Credentials & { name: string; inviteToken?: string };

export type AuthContextValue = {
  user: User | null;
  isAuthenticated: boolean;
  // "two_factor": a senha esta certa, falta o codigo (verifyTwoFactor com o challengeToken)
  login: (credentials: Credentials) => Promise<LoginResult>;
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<void>;
  // Cria a conta e ja entra com ela
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
  // Troca o usuario carregado sem novo login (ex: depois de editar o perfil)
  updateUser: (user: User) => void;
};

// Exportado para os testes poderem montar um estado de login fixo, sem passar pela API
export const AuthContext = createContext<AuthContextValue | null>(null);

// Renova o token antes de ele vencer (60 min) enquanto a aba esta aberta
export const REFRESH_INTERVAL_MS = 20 * 60 * 1000;

type AuthProviderProps = {
  children: ReactNode;
  api?: Api;
  tokenStore?: TokenStore;
};

export function AuthProvider({ children, api = defaultApi, tokenStore = defaultTokenStore }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const isAuthenticated = user !== null;

  // Se o token for limpo por fora (renovacao que falhou), a sessao acaba aqui tambem
  useEffect(() => {
    return tokenStore.subscribe((token) => {
      if (token === null) {
        setUser(null);
        // Nao deixa dados do usuario anterior no cache para o proximo que entrar
        queryClient.clear();
      }
    });
  }, [tokenStore, queryClient]);

  // Renovacao periodica e ao voltar para a aba (o navegador pausa timers em aba suspensa)
  useEffect(() => {
    if (!isAuthenticated) return;
    const refresh = () => void api.refreshAccessToken();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isAuthenticated, api]);

  // Guarda o token e carrega o usuario; sem conseguir carregar o usuario nao ha sessao de verdade
  const startSession = useCallback(
    async (accessToken: string) => {
      tokenStore.set(accessToken);
      try {
        setUser(await unwrap(api.client.GET("/api/v1/auth/me")));
      } catch (error) {
        tokenStore.clear();
        throw error;
      }
    },
    [api, tokenStore],
  );

  const login = useCallback(
    async ({ email, password }: Credentials): Promise<LoginResult> => {
      const result = await unwrap(api.client.POST("/api/v1/auth/login", { body: { email, password } }));
      // Conta com 2FA: a senha certa so rende um desafio, que o segundo passo troca pelo token
      if (result.two_factor_required && result.challenge_token) {
        return { status: "two_factor", challengeToken: result.challenge_token };
      }
      if (!result.access_token) {
        throw new ApiError(500, "internal_error", "Resposta de login sem token");
      }
      await startSession(result.access_token);
      return { status: "ok" };
    },
    [api, startSession],
  );

  const verifyTwoFactor = useCallback(
    async (challengeToken: string, code: string) => {
      const token = await unwrap(
        api.client.POST("/api/v1/auth/2fa/verify", { body: { challenge_token: challengeToken, code } }),
      );
      await startSession(token.access_token);
    },
    [api, startSession],
  );

  const register = useCallback(
    async ({ name, email, password, inviteToken }: RegisterInput) => {
      await unwrap(
        api.client.POST("/api/v1/auth/register", {
          body: { name, email, password, invite_token: inviteToken ?? null },
        }),
      );
      await login({ email, password });
    },
    [api, login],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
  }, [tokenStore]);

  const value = useMemo(
    () => ({ user, isAuthenticated, login, verifyTwoFactor, register, logout, updateUser: setUser }),
    [user, isAuthenticated, login, verifyTwoFactor, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de um AuthProvider");
  return context;
}
