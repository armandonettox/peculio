import { http, HttpResponse } from "msw";

import type { ProfileUpdate, PasswordChange } from "@/api/account";
import type { Invite, InviteCreated } from "@/api/invites";
import type { User } from "@/auth/auth-context";

type NextError = { status: number; code: string };

/**
 * A conta de mentira: editar o perfil devolve o usuario atualizado e trocar a senha confere a senha atual e devolve um
 * token novo, como o servidor vai fazer. Guarda cada pedido para o teste conferir.
 */
export function fakeAccountApi(user: User, { currentPassword = "SenhaAtual123" }: { currentPassword?: string } = {}) {
  const state = {
    user: { ...user },
    profileRequests: [] as ProfileUpdate[],
    passwordRequests: [] as PasswordChange[],
    nextError: null as NextError | null,
    newToken: "token-novo-da-troca-de-senha",
  };

  const fail = (status: number, code: string) => HttpResponse.json({ detail: "erro", code }, { status });
  const takeError = () => {
    const error = state.nextError;
    state.nextError = null;
    return error ? fail(error.status, error.code) : null;
  };

  const handlers = [
    http.patch("*/api/v1/auth/me", async ({ request }) => {
      const body = (await request.json()) as ProfileUpdate;
      state.profileRequests.push(body);
      const error = takeError();
      if (error) return error;
      // Campo ausente ou nulo nao muda, como no servidor
      state.user = {
        ...state.user,
        name: body.name ?? state.user.name,
        default_currency: body.default_currency ?? state.user.default_currency,
      };
      return HttpResponse.json(state.user);
    }),

    http.post("*/api/v1/auth/password", async ({ request }) => {
      const body = (await request.json()) as PasswordChange;
      state.passwordRequests.push(body);
      const error = takeError();
      if (error) return error;
      if (body.current_password !== currentPassword) return fail(400, "invalid_password");
      return HttpResponse.json({ access_token: state.newToken, token_type: "bearer" });
    }),
  ];

  return { handlers, state };
}

let counter = 0;

export function makeInvite(overrides: Partial<Invite> = {}): Invite {
  counter += 1;
  return {
    id: `80000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    email: `pessoa${counter}@example.com`,
    created_at: "2026-03-01T10:00:00Z",
    expires_at: "2026-03-08T10:00:00Z",
    used_at: null,
    ...overrides,
  };
}

/** Convites de mentira, com estado: criar devolve o codigo uma vez e a lista passa a ter o convite; revogar tira da lista. */
export function fakeInvitesApi(initial: Invite[] = []) {
  const state = {
    invites: [...initial],
    requests: [] as { method: string; id?: string; email?: string }[],
    nextError: null as NextError | null,
    listError: false,
    token: "codigo-do-convite-123",
  };

  const fail = (status: number, code: string) => HttpResponse.json({ detail: "erro", code }, { status });
  const takeError = () => {
    const error = state.nextError;
    state.nextError = null;
    return error ? fail(error.status, error.code) : null;
  };

  const handlers = [
    http.get("*/api/v1/invites", () => {
      state.requests.push({ method: "GET" });
      if (state.listError) return fail(500, "internal_error");
      return HttpResponse.json({ items: state.invites, total: state.invites.length, limit: 100, offset: 0 });
    }),

    http.post("*/api/v1/invites", async ({ request }) => {
      const body = (await request.json()) as { email: string };
      state.requests.push({ method: "POST", email: body.email });
      const error = takeError();
      if (error) return error;
      const invite = makeInvite({ email: body.email, created_at: "2026-03-10T10:00:00Z", expires_at: "2026-03-17T10:00:00Z" });
      state.invites.push(invite);
      const created: InviteCreated = { ...invite, token: state.token };
      return HttpResponse.json(created, { status: 201 });
    }),

    http.delete("*/api/v1/invites/:id", ({ params }) => {
      state.requests.push({ method: "DELETE", id: String(params.id) });
      const error = takeError();
      if (error) return error;
      state.invites = state.invites.filter((invite) => invite.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  const writes = () => state.requests.filter((request) => request.method !== "GET");
  return { handlers, state, writes };
}
