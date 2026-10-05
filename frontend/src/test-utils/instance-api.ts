import { http, HttpResponse } from "msw";

type NextError = { status: number; code: string };

/**
 * O contato de seguranca de mentira: ler devolve o que esta salvo e gravar troca (vazio apaga), como o servidor.
 * Guarda cada gravacao para o teste conferir.
 */
export function fakeInstanceApi(initial: string | null = null) {
  const state = {
    contact: initial,
    updatedAt: initial ? "2026-03-10T12:00:00Z" : (null as string | null),
    reads: 0,
    saves: [] as { contact: string | null }[],
    nextError: null as NextError | null,
    readError: false,
  };
  const out = () => ({ contact: state.contact, updated_at: state.contact ? state.updatedAt : null });

  const handlers = [
    http.get("*/api/v1/instance/security-contact", () => {
      state.reads += 1;
      if (state.readError) return HttpResponse.json({ detail: "erro", code: "internal_error" }, { status: 500 });
      return HttpResponse.json(out());
    }),
    http.put("*/api/v1/instance/security-contact", async ({ request }) => {
      const body = (await request.json()) as { contact: string | null };
      state.saves.push(body);
      const error = state.nextError;
      state.nextError = null;
      if (error) return HttpResponse.json({ detail: "erro", code: error.code }, { status: error.status });
      state.contact = body.contact?.trim() ? body.contact.trim() : null;
      state.updatedAt = "2026-03-10T12:05:00Z";
      return HttpResponse.json(out());
    }),
  ];
  return { handlers, state };
}
