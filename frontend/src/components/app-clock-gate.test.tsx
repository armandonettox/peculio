import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse, delay } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { appToday, isAppClockSynced } from "@/lib/app-clock";
import { server } from "@/test-utils/msw";
import { newTestQueryClient } from "@/test-utils/providers";
import { AppClockGate } from "./app-clock-gate";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // O aparelho acha que e 2020; o servidor sabe a data certa
  vi.setSystemTime(new Date("2020-01-15T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

function renderGate() {
  return render(
    <QueryClientProvider client={newTestQueryClient()}>
      <AppClockGate>
        <p>conteudo da tela</p>
      </AppClockGate>
    </QueryClientProvider>,
  );
}

const clockResponse = { now: "2026-03-12T15:00:00Z", timezone: "America/Sao_Paulo", today: "2026-03-12" };

it("segura a tela ate o relogio chegar e entao mostra o conteudo com o dia do servidor", async () => {
  server.use(
    http.get("*/api/v1/clock", async () => {
      await delay(100);
      return HttpResponse.json(clockResponse);
    }),
  );
  renderGate();
  expect(screen.getByRole("status")).toHaveTextContent("Carregando...");
  expect(screen.queryByText("conteudo da tela")).not.toBeInTheDocument();
  expect(await screen.findByText("conteudo da tela")).toBeInTheDocument();
  expect(isAppClockSynced()).toBe(true);
  expect(appToday()).toBe("2026-03-12");
});

it("a primeira renderizacao do conteudo ja usa o dia certo", async () => {
  server.use(http.get("*/api/v1/clock", () => HttpResponse.json(clockResponse)));
  const seen: string[] = [];
  function Probe() {
    seen.push(appToday());
    return <p>sonda</p>;
  }
  render(
    <QueryClientProvider client={newTestQueryClient()}>
      <AppClockGate>
        <Probe />
      </AppClockGate>
    </QueryClientProvider>,
  );
  await screen.findByText("sonda");
  expect(seen[0]).toBe("2026-03-12");
});

it("se o pedido falhar, mostra a tela mesmo assim, com o relogio do aparelho", async () => {
  server.use(http.get("*/api/v1/clock", () => HttpResponse.json({ detail: "erro", code: "internal_error" }, { status: 500 })));
  renderGate();
  expect(await screen.findByText("conteudo da tela")).toBeInTheDocument();
  expect(isAppClockSynced()).toBe(false);
  expect(appToday()).toMatch(/^2020-01-1[45]$/);
});

it("se o servidor mandar um fuso invalido, mostra a tela e nao sincroniza", async () => {
  server.use(http.get("*/api/v1/clock", () => HttpResponse.json({ ...clockResponse, timezone: "Marte/Olympus" })));
  renderGate();
  expect(await screen.findByText("conteudo da tela")).toBeInTheDocument();
  expect(isAppClockSynced()).toBe(false);
});
