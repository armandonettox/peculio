import { http, HttpResponse } from "msw";

export const GOOD_CODE = "123456";
export const GOOD_PASSWORD = "SenhaForte123";
export const SECRET = "JBSWY3DPEHPK3PXP";

const CODES = Array.from({ length: 10 }, (_, index) => `aaaaa${index}-bbbbb${index}`);
const NEW_CODES = Array.from({ length: 10 }, (_, index) => `nnnnn${index}-mmmmm${index}`);

type Recorded = { path: string; body?: Record<string, unknown> };

/**
 * API de 2FA de mentira com estado: ativar, desativar e gerar codigos mudam o que o proximo
 * GET /status devolve, como o backend de verdade. O unico codigo aceito e GOOD_CODE e a unica
 * senha e GOOD_PASSWORD.
 */
export function fakeTwoFactorApi({ enabled = false, remaining = 10 } = {}) {
  const state = {
    enabled,
    remaining,
    requests: [] as Recorded[],
    statusError: false,
    setupError: false,
    nextEnableError: null as { status: number; code: string } | null,
  };

  const fail = (status: number, code: string) => HttpResponse.json({ detail: "erro", code }, { status });
  const record = (path: string, body?: unknown) =>
    state.requests.push({ path, ...(body ? { body: body as Record<string, unknown> } : {}) });

  const handlers = [
    http.get("*/api/v1/auth/2fa/status", () => {
      if (state.statusError) return fail(500, "internal_error");
      return HttpResponse.json({ enabled: state.enabled, recovery_codes_remaining: state.remaining });
    }),

    http.post("*/api/v1/auth/2fa/setup", () => {
      record("/setup");
      if (state.setupError) return fail(500, "internal_error");
      if (state.enabled) return fail(409, "two_factor_already_enabled");
      return HttpResponse.json({
        secret: SECRET,
        otpauth_url: `otpauth://totp/peculio:ana%40example.com?secret=${SECRET}&issuer=peculio`,
      });
    }),

    http.post("*/api/v1/auth/2fa/enable", async ({ request }) => {
      const body = (await request.json()) as { code: string };
      record("/enable", body);
      if (state.nextEnableError) {
        const error = state.nextEnableError;
        state.nextEnableError = null;
        return fail(error.status, error.code);
      }
      if (body.code !== GOOD_CODE) return fail(401, "two_factor_invalid_code");
      state.enabled = true;
      state.remaining = CODES.length;
      return HttpResponse.json({ recovery_codes: CODES });
    }),

    http.post("*/api/v1/auth/2fa/disable", async ({ request }) => {
      const body = (await request.json()) as { password: string; code: string };
      record("/disable", body);
      if (body.password !== GOOD_PASSWORD) return fail(403, "invalid_password");
      if (body.code !== GOOD_CODE) return fail(401, "two_factor_invalid_code");
      state.enabled = false;
      state.remaining = 0;
      return new HttpResponse(null, { status: 204 });
    }),

    http.post("*/api/v1/auth/2fa/recovery-codes", async ({ request }) => {
      const body = (await request.json()) as { password: string; code: string };
      record("/recovery-codes", body);
      if (body.password !== GOOD_PASSWORD) return fail(403, "invalid_password");
      if (body.code !== GOOD_CODE) return fail(401, "two_factor_invalid_code");
      state.remaining = NEW_CODES.length;
      return HttpResponse.json({ recovery_codes: NEW_CODES });
    }),
  ];

  const calls = (path: string) => state.requests.filter((request) => request.path === path);
  return { handlers, state, calls, codes: CODES, newCodes: NEW_CODES };
}
