import { expect, it } from "vitest";

import { formatBytes } from "./format";

it("formata o tamanho em B, KB, MB e GB", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(850)).toBe("850 B");
  expect(formatBytes(1023)).toBe("1023 B");
  expect(formatBytes(1024)).toBe("1 KB");
  expect(formatBytes(1536)).toBe("1,5 KB");
  expect(formatBytes(10 * 1024)).toBe("10 KB");
  expect(formatBytes(2.3 * 1024 * 1024)).toBe("2,3 MB");
  expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3 GB");
});
