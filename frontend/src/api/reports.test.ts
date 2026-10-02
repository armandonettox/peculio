import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";

import { tokenStore } from "@/auth/token-store";
import { server } from "@/test-utils/msw";
import { downloadTransactionsCsv } from "./reports";

const URL_PATH = "*/api/v1/transactions/export.csv";

function csvResponse(filename = "lancamentos-2026-03-15.csv") {
  return new HttpResponse("data;tipo\r\n", {
    headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}

it("manda o token no cabecalho Authorization e nunca na URL", async () => {
  tokenStore.set("abc123");
  let seen: Request | null = null;
  server.use(
    http.get(URL_PATH, ({ request }) => {
      seen = request;
      return csvResponse();
    }),
  );
  const file = await downloadTransactionsCsv({ dateFrom: "2026-01-01", dateTo: "2026-01-31" });
  expect(seen).not.toBeNull();
  const request = seen as unknown as Request;
  expect(request.headers.get("Authorization")).toBe("Bearer abc123");
  expect(request.url).not.toContain("abc123");
  expect(new URL(request.url).searchParams.get("date_from")).toBe("2026-01-01");
  expect(file.filename).toBe("lancamentos-2026-03-15.csv");
  expect(await file.blob.text()).toBe("data;tipo\r\n");
});

it("traduz os filtros para os parametros da API e omite os vazios", async () => {
  let url = "";
  server.use(
    http.get(URL_PATH, ({ request }) => {
      url = request.url;
      return csvResponse();
    }),
  );
  await downloadTransactionsCsv({ accountId: "a", categoryId: "c", tagId: "t", budgetId: "o" });
  const query = new URL(url).searchParams;
  expect([...query.keys()].sort()).toEqual(["account_id", "budget_id", "category_id", "tag_id"]);
  await downloadTransactionsCsv({});
  expect(new URL(url).search).toBe("");
});

it("sem cabecalho de nome usa um nome padrao", async () => {
  server.use(http.get(URL_PATH, () => new HttpResponse("x")));
  expect((await downloadTransactionsCsv({})).filename).toBe("lancamentos.csv");
});

it("erro do servidor vira ApiError com o codigo", async () => {
  server.use(http.get(URL_PATH, () => HttpResponse.json({ detail: "x", code: "internal_error" }, { status: 500 })));
  await expect(downloadTransactionsCsv({})).rejects.toMatchObject({ status: 500, code: "internal_error" });
});

it("erro sem corpo JSON ainda vira ApiError", async () => {
  server.use(http.get(URL_PATH, () => new HttpResponse("falhou", { status: 502 })));
  await expect(downloadTransactionsCsv({})).rejects.toMatchObject({ status: 502, code: "http_502" });
});

it("falha de rede vira erro de conexao", async () => {
  server.use(http.get(URL_PATH, () => HttpResponse.error()));
  await expect(downloadTransactionsCsv({})).rejects.toMatchObject({ code: "network_error" });
});

it("num 401 renova a sessao uma vez e tenta de novo com o token novo", async () => {
  tokenStore.set("velho");
  const auth: (string | null)[] = [];
  server.use(
    http.get(URL_PATH, ({ request }) => {
      auth.push(request.headers.get("Authorization"));
      return request.headers.get("Authorization") === "Bearer novo"
        ? csvResponse()
        : HttpResponse.json({ detail: "x", code: "token_invalid" }, { status: 401 });
    }),
    http.post("*/api/v1/auth/refresh", () => HttpResponse.json({ access_token: "novo" })),
  );
  const file = await downloadTransactionsCsv({});
  expect(auth).toEqual(["Bearer velho", "Bearer novo"]);
  expect(file.filename).toBe("lancamentos-2026-03-15.csv");
});

it("se a renovacao falha, devolve o 401", async () => {
  tokenStore.set("velho");
  server.use(
    http.get(URL_PATH, () => HttpResponse.json({ detail: "x", code: "token_invalid" }, { status: 401 })),
    http.post("*/api/v1/auth/refresh", () => HttpResponse.json({ detail: "x", code: "session_expired" }, { status: 401 })),
  );
  await expect(downloadTransactionsCsv({})).rejects.toMatchObject({ status: 401, code: "token_invalid" });
});
