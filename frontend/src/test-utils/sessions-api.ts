import { http, HttpResponse } from "msw";

import type { AuthSession } from "@/api/sessions";

type NextError = { status: number; code: string };

let counter = 0;

export function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    device_label: "Chrome no Windows",
    remember: false,
    created_at: "2026-03-09T10:00:00Z",
    last_used_at: "2026-03-10T11:30:00Z",
    expires_at: "2026-03-20T10:00:00Z",
    current: false,
    ...overrides,
  };
}

/**
 * Os aparelhos conectados de mentira: listar devolve o que ha, encerrar um tira da lista e encerrar os outros tira todos
 * menos o atual, como o servidor. Guarda cada pedido para o teste conferir.
 */
export function fakeSessionsApi(initial: AuthSession[] = []) {
  const state = {
    sessions: [...initial],
    requests: [] as { method: string; id?: string }[],
    nextError: null as NextError | null,
    listError: false,
  };
  const fail = (status: number, code: string) => HttpResponse.json({ detail: "erro", code }, { status });
  const takeError = () => {
    const error = state.nextError;
    state.nextError = null;
    return error ? fail(error.status, error.code) : null;
  };

  const handlers = [
    http.get("*/api/v1/auth/sessions", () => {
      state.requests.push({ method: "GET" });
      if (state.listError) return fail(500, "internal_error");
      return HttpResponse.json(state.sessions);
    }),
    http.delete("*/api/v1/auth/sessions/:id", ({ params }) => {
      const id = String(params.id);
      state.requests.push({ method: "DELETE", id });
      const error = takeError();
      if (error) return error;
      state.sessions = state.sessions.filter((session) => session.id !== id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("*/api/v1/auth/sessions", () => {
      state.requests.push({ method: "DELETE-OTHERS" });
      const error = takeError();
      if (error) return error;
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((session) => session.current);
      return HttpResponse.json({ revoked: before - state.sessions.length });
    }),
  ];
  return { handlers, state };
}
