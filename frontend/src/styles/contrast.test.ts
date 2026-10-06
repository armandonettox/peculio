import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CHART_COLOR_NAMES } from "@/components/charts/chart-colors";

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
  ["warning", "background", AA_TEXT, "aviso de orcamento perto do limite"],
  ["warning", "card", AA_TEXT, "aviso de orcamento perto do limite no card"],
  ["ring", "background", AA_NON_TEXT, "anel de foco"],
  ["ring", "card", AA_NON_TEXT, "anel de foco no card"],
];

// Cores dos graficos: elementos graficos precisam de 3:1 (WCAG 1.4.11) contra o fundo e o card
const chartPairs: [string, string, number, string][] = CHART_COLOR_NAMES.flatMap((name) => [
  [`chart-${name}`, "background", AA_NON_TEXT, `cor ${name} do grafico`] as [string, string, number, string],
  [`chart-${name}`, "card", AA_NON_TEXT, `cor ${name} do grafico no card`] as [string, string, number, string],
]);

describe.each([
  ["claro", readTokens(":root")],
  ["escuro", readTokens("\\.dark")],
])("contraste no tema %s", (_name, tokens) => {
  it.each(pairs)("%s sobre %s (minimo %s): %s", (fg, bg, minimum) => {
    expect(tokens[fg], `token ${fg} ausente`).toBeDefined();
    expect(tokens[bg], `token ${bg} ausente`).toBeDefined();
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(minimum);
  });

  it.each(chartPairs)("%s sobre %s (minimo %s): %s", (fg, bg, minimum) => {
    expect(tokens[fg], `token ${fg} ausente`).toBeDefined();
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(minimum);
  });

  it("branco sobre o verde escuro de suporte passa", () => {
    expect(contrast("#ffffff", tokens["support"])).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("tokens dos graficos", () => {
  it("cada ChartColor tem token nos dois temas, em hex", () => {
    for (const tokens of [readTokens(":root"), readTokens("\\.dark")]) {
      for (const name of CHART_COLOR_NAMES) {
        expect(tokens[`chart-${name}`], `chart-${name}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("cada token de grafico esta exposto no tema do Tailwind", () => {
    for (const name of CHART_COLOR_NAMES) {
      expect(css).toContain(`--color-chart-${name}: var(--chart-${name});`);
    }
  });

  it("as cores dos graficos sao distintas entre si em cada tema", () => {
    for (const tokens of [readTokens(":root"), readTokens("\\.dark")]) {
      const values = CHART_COLOR_NAMES.map((name) => tokens[`chart-${name}`].toLowerCase());
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

// Matiz (0 a 360) de uma cor em hex
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const delta = max - min;
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
}

const isGreen = (hex: string) => {
  const h = hue(hex);
  return h >= 90 && h <= 170;
};

// ---------- Fundos calculados ----------
// O Tailwind deriva "muted" e "accent" de outros tokens com color-mix. O teste de pares so lia hex solto, entao o par
// "texto secundario sobre muted" (4,22:1 no claro) passou despercebido ate o axe achar no navegador.

function mixFormula(name: string): { from: string; percent: number; into: string } {
  const match = css.match(new RegExp(`--color-${name}:\\s*color-mix\\(in srgb,\\s*var\\(--([\\w-]+)\\)\\s*(\\d+)%,\\s*var\\(--([\\w-]+)\\)\\)`));
  if (!match) throw new Error(`--color-${name} nao e um color-mix no index.css`);
  return { from: match[1], percent: Number(match[2]), into: match[3] };
}

function mixHex(a: string, b: string, percentOfA: number): string {
  const channel = (i: number) => {
    const x = parseInt(a.slice(i, i + 2), 16);
    const y = parseInt(b.slice(i, i + 2), 16);
    return Math.round((x * percentOfA) / 100 + (y * (100 - percentOfA)) / 100);
  };
  return "#" + [1, 3, 5].map((i) => channel(i).toString(16).padStart(2, "0")).join("");
}

describe.each([
  ["claro", readTokens(":root")],
  ["escuro", readTokens("\\.dark")],
])("fundos calculados no tema %s", (_name, tokens) => {
  const derived = (name: string) => {
    const { from, percent, into } = mixFormula(name);
    return mixHex(tokens[from], tokens[into], percent);
  };

  it("texto secundario sobre o fundo muted passa no AA", () => {
    expect(contrast(tokens["muted-foreground"], derived("muted"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("texto principal sobre o fundo accent passa no AA", () => {
    expect(contrast(tokens["foreground"], derived("accent"))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("tema escuro sem verde", () => {
  const dark = readTokens("\\.dark");

  it.each(["card", "popover", "border", "input", "ring", "brand-accent", "support", "chart-accent", "chart-primary"])(
    "%s nao e verde",
    (name) => {
      expect(isGreen(dark[name]), `${name} = ${dark[name]}`).toBe(false);
    },
  );

  it("as superficies e as bordas sao azuis", () => {
    for (const name of ["card", "popover", "border", "input"]) {
      const h = hue(dark[name]);
      expect(h, `${name} = ${dark[name]}`).toBeGreaterThanOrEqual(200);
      expect(h, `${name} = ${dark[name]}`).toBeLessThanOrEqual(250);
    }
  });

  it("o verde que sobra e so o do valor que entra", () => {
    const green = Object.entries(dark).filter(([, value]) => isGreen(value)).map(([name]) => name).sort();
    expect(green).toEqual(["chart-positive", "positive"]);
  });

  it("o card se distingue do fundo", () => {
    expect(dark["card"].toLowerCase()).not.toBe(dark["background"].toLowerCase());
  });

  it("o tema claro nao mudou: continua com a marca verde", () => {
    const light = readTokens(":root");
    expect(isGreen(light["brand-accent"])).toBe(true);
    expect(isGreen(light["positive"])).toBe(true);
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
