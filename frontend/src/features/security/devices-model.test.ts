import { describe, expect, it } from "vitest";

import { devicesText, lastUsedLabel, otherDevicesCount, sortDevices } from "./devices-model";

const NOW = new Date("2026-03-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("lastUsedLabel", () => {
  it.each([
    [0, "agora"],
    [59_999, "agora"],
    [MIN, "há 1 min"],
    [5 * MIN, "há 5 min"],
    [HOUR - 1, "há 59 min"],
    [HOUR, "há 1 h"],
    [3 * HOUR + 40 * MIN, "há 3 h"],
    [DAY - 1, "há 23 h"],
    [DAY, "há 1 dia"],
    [DAY + 23 * HOUR, "há 1 dia"],
    [2 * DAY, "há 2 dias"],
    [12 * DAY, "há 12 dias"],
  ])("%i ms atras: %s", (elapsed, expected) => expect(lastUsedLabel(ago(elapsed), NOW)).toBe(expected));

  it("data no futuro (relogio atrasado) conta como agora", () => {
    expect(lastUsedLabel(ago(-5 * MIN), NOW)).toBe("agora");
  });
});

describe("sortDevices", () => {
  const row = (id: string, current: boolean, minutesAgo: number) => ({ id, current, last_used_at: ago(minutesAgo * MIN) });

  it("este aparelho primeiro, o resto do mais recente ao mais antigo", () => {
    const sorted = sortDevices([row("velho", false, 600), row("atual", true, 5), row("novo", false, 1)]);
    expect(sorted.map((item) => item.id)).toEqual(["atual", "novo", "velho"]);
  });

  it("o atual vai primeiro mesmo sendo o mais antigo", () => {
    expect(sortDevices([row("a", false, 1), row("atual", true, 9999)]).map((item) => item.id)).toEqual(["atual", "a"]);
  });

  it("nao altera a lista de origem", () => {
    const original = [row("a", false, 10), row("b", false, 1)];
    sortDevices(original);
    expect(original.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("otherDevicesCount e devicesText", () => {
  it("conta so os que nao sao este", () => {
    expect(otherDevicesCount([{ current: true, last_used_at: "" }, { current: false, last_used_at: "" }, { current: false, last_used_at: "" }])).toBe(2);
    expect(otherDevicesCount([{ current: true, last_used_at: "" }])).toBe(0);
    expect(otherDevicesCount([])).toBe(0);
  });

  it("singular e plural", () => {
    expect(devicesText(1)).toBe("1 aparelho");
    expect(devicesText(0)).toBe("0 aparelhos");
    expect(devicesText(3)).toBe("3 aparelhos");
  });
});
