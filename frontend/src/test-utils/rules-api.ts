import { http, HttpResponse } from "msw";

import type { Rule, RuleApplied, RuleGroup, RulePreview } from "@/api/rules";

let counter = 0;

export function makeRule(overrides: Partial<Rule> = {}): Rule {
  counter += 1;
  return {
    id: `r0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    group_id: null,
    name: `Regra ${counter}`,
    position: 0,
    match_mode: "all",
    stop_processing: false,
    active: true,
    triggers: [{ field: "description", op: "contains", value: "mercado" }],
    actions: [{ kind: "set_category", target_id: "c0000000-0000-4000-8000-000000000001" }],
    created_at: `2026-01-01T00:00:${String(counter % 60).padStart(2, "0")}Z`,
    ...overrides,
  };
}

export function makeRuleGroup(overrides: Partial<RuleGroup> = {}): RuleGroup {
  counter += 1;
  return {
    id: `g0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Grupo ${counter}`,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

type NextError = { status: number; code: string; errors?: { field: string; message: string }[] };
type Recorded = { method: string; path: string; body?: Record<string, unknown> };

/**
 * API de regras de mentira, com estado. Ordena como o backend (grupos pela posicao, depois as regras
 * sem grupo), recusa nome repetido sem diferenciar maiuscula de minuscula e solta as regras de um
 * grupo excluido. A previa e a aplicacao devolvem o que o teste colocar em `state`.
 */
export function fakeRulesApi(initial: { rules?: Rule[]; groups?: RuleGroup[] } = {}) {
  const state = {
    rules: [...(initial.rules ?? [])],
    groups: [...(initial.groups ?? [])],
    requests: [] as Recorded[],
    nextMutationError: null as NextError | null,
    listError: false,
    preview: { scanned: 0, changed: 0, truncated: false, items: [] } as RulePreview,
    applied: { scanned: 0, changed: 0 } as RuleApplied,
  };

  const fail = (error: NextError) =>
    HttpResponse.json(
      { detail: "erro", code: error.code, ...(error.errors ? { errors: error.errors } : {}) },
      { status: error.status },
    );
  const takeError = () => {
    const error = state.nextMutationError;
    state.nextMutationError = null;
    return error;
  };
  const ordered = () => {
    const position = new Map(state.groups.map((group) => [group.id, group.position]));
    return [...state.rules].sort((a, b) => {
      const groupA = a.group_id ? (position.get(a.group_id) ?? 0) : Number.MAX_SAFE_INTEGER;
      const groupB = b.group_id ? (position.get(b.group_id) ?? 0) : Number.MAX_SAFE_INTEGER;
      return groupA - groupB || a.position - b.position || a.created_at.localeCompare(b.created_at);
    });
  };
  const sameName = (list: { id: string; name: string }[], name: string, ignoreId?: string) =>
    list.some((item) => item.id !== ignoreId && item.name.toLowerCase() === name.trim().toLowerCase());
  const record = (method: string, path: string, body?: Record<string, unknown>) =>
    state.requests.push({ method, path, ...(body ? { body } : {}) });

  const handlers = [
    http.get("*/api/v1/rules", () => {
      record("GET", "/rules");
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const items = ordered();
      return HttpResponse.json({ items, total: items.length, limit: 200, offset: 0 });
    }),

    http.get("*/api/v1/rule-groups", () => {
      record("GET", "/rule-groups");
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      return HttpResponse.json([...state.groups].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)));
    }),

    http.post("*/api/v1/rules/preview", async ({ request }) => {
      record("POST", "/rules/preview", (await request.json()) as Record<string, unknown>);
      const error = takeError();
      if (error) return fail(error);
      return HttpResponse.json(state.preview);
    }),

    http.post("*/api/v1/rules/apply", async ({ request }) => {
      record("POST", "/rules/apply", (await request.json()) as Record<string, unknown>);
      const error = takeError();
      if (error) return fail(error);
      return HttpResponse.json(state.applied);
    }),

    http.post("*/api/v1/rules", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      record("POST", "/rules", body);
      const error = takeError();
      if (error) return fail(error);
      if (sameName(state.rules, String(body.name))) return fail({ status: 409, code: "rule_name_taken" });
      const created = makeRule({ ...(body as Partial<Rule>), group_id: (body.group_id as string | null) ?? null });
      state.rules.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),

    http.patch("*/api/v1/rules/:id", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      record("PATCH", `/rules/${params.id}`, body);
      const error = takeError();
      if (error) return fail(error);
      const index = state.rules.findIndex((item) => item.id === params.id);
      if (index < 0) return fail({ status: 404, code: "rule_not_found" });
      if (typeof body.name === "string" && sameName(state.rules, body.name, String(params.id))) {
        return fail({ status: 409, code: "rule_name_taken" });
      }
      state.rules[index] = { ...state.rules[index], ...(body as Partial<Rule>) };
      return HttpResponse.json(state.rules[index]);
    }),

    http.delete("*/api/v1/rules/:id", ({ params }) => {
      record("DELETE", `/rules/${params.id}`);
      const error = takeError();
      if (error) return fail(error);
      state.rules = state.rules.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),

    http.post("*/api/v1/rule-groups", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      record("POST", "/rule-groups", body);
      const error = takeError();
      if (error) return fail(error);
      if (sameName(state.groups, String(body.name))) return fail({ status: 409, code: "rule_group_name_taken" });
      const created = makeRuleGroup({ name: String(body.name), position: Number(body.position ?? 0) });
      state.groups.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),

    http.patch("*/api/v1/rule-groups/:id", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      record("PATCH", `/rule-groups/${params.id}`, body);
      const error = takeError();
      if (error) return fail(error);
      const index = state.groups.findIndex((item) => item.id === params.id);
      if (index < 0) return fail({ status: 404, code: "rule_group_not_found" });
      if (typeof body.name === "string" && sameName(state.groups, body.name, String(params.id))) {
        return fail({ status: 409, code: "rule_group_name_taken" });
      }
      state.groups[index] = { ...state.groups[index], ...(body as Partial<RuleGroup>) };
      return HttpResponse.json(state.groups[index]);
    }),

    http.delete("*/api/v1/rule-groups/:id", ({ params }) => {
      record("DELETE", `/rule-groups/${params.id}`);
      const error = takeError();
      if (error) return fail(error);
      state.groups = state.groups.filter((item) => item.id !== params.id);
      state.rules = state.rules.map((rule) => (rule.group_id === params.id ? { ...rule, group_id: null } : rule));
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  const mutations = () => state.requests.filter((request) => request.method !== "GET");
  return { handlers, state, mutations };
}
