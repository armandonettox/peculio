import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { mockMatchMedia } from "@/test-utils/match-media";
import App from "./App";

afterEach(() => vi.unstubAllGlobals());

it("mostra o status da API quando ela responde", async () => {
  mockMatchMedia(false);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve({ status: "ok" }) }),
  );
  render(<App />);
  expect(screen.getByRole("heading", { name: "finance-app" })).toBeInTheDocument();
  expect(await screen.findByText("API: ok")).toBeInTheDocument();
});

it("avisa quando a API esta fora do ar", async () => {
  mockMatchMedia(false);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sem rede")));
  render(<App />);
  expect(await screen.findByText("API: fora do ar")).toBeInTheDocument();
});
