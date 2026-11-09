import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";

import { server } from "@/test-utils/msw";
import { FakeAuth, testUser } from "@/test-utils/providers";
import { OnboardingTour, OPEN_TOUR_EVENT } from "./onboarding-tour";

// O servidor de mentira so anota o que o passo a passo manda ao fechar
function trackProfile() {
  const sent: Record<string, unknown>[] = [];
  server.use(
    http.patch("*/api/v1/auth/me", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      sent.push(body);
      return HttpResponse.json({ ...testUser, ...body });
    }),
  );
  return sent;
}

function renderTour(onboardingDone: boolean) {
  render(
    <FakeAuth user={{ ...testUser, onboarding_done: onboardingDone }}>
      <MemoryRouter>
        <OnboardingTour />
      </MemoryRouter>
    </FakeAuth>,
  );
}

const tour = () => screen.getByRole("dialog");

it("abre sozinho para quem ainda nao viu, no primeiro passo", async () => {
  renderTour(false);
  expect(await screen.findByRole("dialog", { name: "Bem-vindo ao Pecúlio" })).toBeInTheDocument();
  expect(within(tour()).getByText("Passo 1 de 7")).toBeInTheDocument();
  expect(within(tour()).queryByRole("button", { name: "Voltar" })).not.toBeInTheDocument();
});

it("nao abre para quem ja viu", () => {
  renderTour(true);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("Proximo e Voltar andam pelos sete passos e o ultimo tem Concluir em vez de Pular", async () => {
  renderTour(false);
  await screen.findByRole("dialog");
  for (let step = 2; step <= 7; step += 1) {
    await userEvent.click(within(tour()).getByRole("button", { name: "Próximo" }));
    expect(within(tour()).getByText(`Passo ${step} de 7`)).toBeInTheDocument();
  }
  expect(within(tour()).queryByRole("button", { name: "Pular" })).not.toBeInTheDocument();
  expect(within(tour()).queryByRole("button", { name: "Próximo" })).not.toBeInTheDocument();
  expect(within(tour()).getByRole("button", { name: "Concluir" })).toBeInTheDocument();

  await userEvent.click(within(tour()).getByRole("button", { name: "Voltar" }));
  expect(within(tour()).getByText("Passo 6 de 7")).toBeInTheDocument();
});

it("os passos com destino tem um botao que leva para la e fecha o passo a passo", async () => {
  const sent = trackProfile();
  renderTour(false);
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Próximo" }));
  const go = within(tour()).getByRole("link", { name: "Ir para Contas" });
  expect(go).toHaveAttribute("href", "/contas");
  await userEvent.click(go);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(sent).toEqual([{ onboarding_done: true }]));
});

it("Pular fecha em qualquer passo e avisa o servidor que a pessoa ja viu", async () => {
  const sent = trackProfile();
  renderTour(false);
  await screen.findByRole("dialog");
  await userEvent.click(within(tour()).getByRole("button", { name: "Pular" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(sent).toEqual([{ onboarding_done: true }]));
});

it("Esc tambem fecha e conta como visto", async () => {
  const sent = trackProfile();
  renderTour(false);
  await screen.findByRole("dialog");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(sent).toEqual([{ onboarding_done: true }]));
});

it("Concluir no ultimo passo fecha e marca como visto", async () => {
  const sent = trackProfile();
  renderTour(false);
  await screen.findByRole("dialog");
  for (let step = 2; step <= 7; step += 1) await userEvent.click(within(tour()).getByRole("button", { name: "Próximo" }));
  await userEvent.click(within(tour()).getByRole("button", { name: "Concluir" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(sent).toEqual([{ onboarding_done: true }]));
});

it("quem ja viu pode reabrir pelo evento do menu, volta ao primeiro passo e fechar de novo nao escreve nada", async () => {
  const sent = trackProfile();
  renderTour(true);
  window.dispatchEvent(new Event(OPEN_TOUR_EVENT));
  expect(await screen.findByRole("dialog", { name: "Bem-vindo ao Pecúlio" })).toBeInTheDocument();
  await userEvent.click(within(tour()).getByRole("button", { name: "Próximo" }));
  await userEvent.click(within(tour()).getByRole("button", { name: "Pular" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // Ja estava marcado: nao ha nada para gravar
  expect(sent).toEqual([]);
});
