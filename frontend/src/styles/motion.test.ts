import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Quem pede menos movimento no sistema nao pode ver animacao nem transicao. Confere a regra direto no index.css.
const css = readFileSync(path.resolve(__dirname, "../index.css"), "utf-8");

function reducedMotionBlock(): string {
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  if (start === -1) throw new Error("falta o bloco prefers-reduced-motion no index.css");
  // O bloco acaba na chave que fecha o @media (as chaves de dentro vem em pares)
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error("bloco prefers-reduced-motion sem fechamento");
}

describe("movimento reduzido", () => {
  const block = reducedMotionBlock();

  it("vale para todos os elementos e seus pseudo-elementos", () => {
    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after/);
  });

  it.each(["animation-duration", "transition-duration"])("zera %s (quase zero, com !important)", (property) => {
    expect(block).toMatch(new RegExp(`${property}:\\s*0\\.01ms\\s*!important`));
  });

  it("anima so uma vez e nao rola suavemente", () => {
    expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(block).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });
});
