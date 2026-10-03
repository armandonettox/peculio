// O "hoje" do app e o do servidor (APP_TIMEZONE), nao o do aparelho: o relogio do aparelho pode estar
// errado e o fuso dele pode ser outro. Depois de sincronizar, cada chamada calcula o dia como o
// servidor calcularia, sem pedir nada de novo; se a sincronizacao nunca acontecer, vale o relogio do aparelho.

type ClockState = { offsetMs: number; timeZone: string };

let state: ClockState | null = null;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Guarda a diferenca entre o relogio do servidor e o do aparelho e o fuso do app. Ignora dado invalido. */
export function syncAppClock(server: { now: string; timezone: string }, localNowMs: number = Date.now()): void {
  const serverMs = Date.parse(server.now);
  if (Number.isNaN(serverMs) || !isValidTimeZone(server.timezone)) return;
  state = { offsetMs: serverMs - localNowMs, timeZone: server.timezone };
}

/** Volta ao relogio do aparelho (usado nos testes). */
export function resetAppClock(): void {
  state = null;
}

export const isAppClockSynced = () => state !== null;

/** O instante atual segundo o servidor. */
export function appNow(): Date {
  return new Date(Date.now() + (state?.offsetMs ?? 0));
}

/** O dia de hoje ("AAAA-MM-DD") no fuso do app. Sueco so pelo formato ISO; toISOString usaria UTC e viraria o dia cedo. */
export function appToday(): string {
  return appNow().toLocaleDateString("sv-SE", state ? { timeZone: state.timeZone } : undefined);
}
