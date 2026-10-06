// Regras da lista "Aparelhos conectados", sem tela: como dizer ha quanto tempo o aparelho foi usado e em que ordem
// mostrar. Ficam aqui, com testes, e a tela so as usa.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "agora", "há 5 min", "há 3 h", "há 1 dia", "há 12 dias". Relógio atrasado (data no futuro) conta como "agora". */
export function lastUsedLabel(iso: string, now: Date): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (elapsed < MINUTE) return "agora";
  if (elapsed < HOUR) return `há ${Math.floor(elapsed / MINUTE)} min`;
  if (elapsed < DAY) return `há ${Math.floor(elapsed / HOUR)} h`;
  const days = Math.floor(elapsed / DAY);
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

type Row = { current: boolean; last_used_at: string };

/** Este aparelho primeiro; o resto do mais recente para o mais antigo. */
export function sortDevices<T extends Row>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime();
  });
}

/** Quantos aparelhos além deste estão conectados. */
export function otherDevicesCount(sessions: readonly Row[]): number {
  return sessions.filter((session) => !session.current).length;
}

/** "1 aparelho" / "3 aparelhos" */
export function devicesText(count: number): string {
  return count === 1 ? "1 aparelho" : `${count} aparelhos`;
}
