import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Confere o contraste (WCAG) de cada par texto e fundo nos dois temas, direto do index.css.
// Se alguem trocar uma cor e piorar a leitura, o teste acusa.

const css = readFileSync(path.resolve(__dirname, "../index.css"), "utf-8");

function readTokens(selector: string): Record<string, string> {
  const block = css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`bloco ${selector} nao encontrado no index.css`);
  const tokens: Record<string, string> = {};
  for (const match of block[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

// [cor, fundo, minimo, descricao]
const pairs: [string, string, number, string][] = [
  ["foreground", "background", AA_TEXT, "texto principal"],
  ["foreground", "card", AA_TEXT, "texto principal no card"],
  ["card-foreground", "card", AA_TEXT, "texto do card"],
  ["muted-foreground", "background", AA_TEXT, "texto secundario"],
  ["muted-foreground", "card", AA_TEXT, "texto secundario no card"],
  ["primary-foreground", "primary", AA_TEXT, "texto do botao principal"],
  ["primary-text", "background", AA_TEXT, "titulos na cor primaria"],
  ["primary-text", "card", AA_TEXT, "titulos na cor primaria no card"],
  ["brand-accent-foreground", "brand-accent", AA_TEXT, "texto sobre o verde de destaque"],
  ["destructive-foreground", "destructive", AA_TEXT, "texto do botao de excluir"],
  ["destructive", "background", AA_TEXT, "mensagem de erro"],
  ["positive", "background", AA_TEXT, "valor que entra"],
  ["positive", "card", AA_TEXT, "valor que entra no card"],
  ["ring", "background", AA_NON_TEXT, "anel de foco"],
  ["ring", "card", AA_NON_TEXT, "anel de foco no card"],
];

describe.each([
  ["claro", readTokens(":root")],
  ["escuro", readTokens("\\.dark")],
])("contraste no tema %s", (_name, tokens) => {
  it.each(pairs)("%s sobre %s (minimo %s): %s", (fg, bg, minimum) => {
    expect(tokens[fg], `token ${fg} ausente`).toBeDefined();
    expect(tokens[bg], `token ${bg} ausente`).toBeDefined();
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(minimum);
  });

  it("branco sobre o verde escuro de suporte passa", () => {
    expect(contrast("#ffffff", tokens["support"])).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("paleta", () => {
  it("usa as cores da Netto Code v3", () => {
    const light = readTokens(":root");
    expect(light["primary"].toLowerCase()).toBe("#1e3a6b");
    expect(light["brand-accent"].toLowerCase()).toBe("#00a878");
    expect(light["support"].toLowerCase()).toBe("#01603b");
    expect(light["background"].toLowerCase()).toBe("#f8f9fa");
  });

  it("branco sobre o verde de destaque nao passa, por isso o texto dele e escuro", () => {
    const light = readTokens(":root");
    expect(contrast("#ffffff", light["brand-accent"])).toBeLessThan(AA_TEXT);
  });
});
