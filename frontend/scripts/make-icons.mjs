// Gera os icones do app (PWA) a partir do porquinho da marca (brand/peculio-favicon.svg). Roda uma vez e os arquivos
// ficam no repositorio:
//   node scripts/make-icons.mjs
// Usa o Chromium do Playwright so para transformar SVG em PNG.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "icons");
mkdirSync(out, { recursive: true });

// O desenho do porquinho vem do SVG da marca: so os dois caminhos coloridos, sem o fundo
const brandSvg = path.join(root, "..", "brand", "peculio-favicon.svg");
const PIG = readFileSync(brandSvg, "utf8")
  .split(/\r?\n/)
  .filter((line) => line.includes("<path"))
  .join("\n");

// Fundo branco: o broto e a orelha sao navy e sumiriam sobre um fundo navy.
// Tudo desenhado numa tela de 512: `scale` diz quanto o porquinho (que ocupa quase a tela toda) encolhe.
function svg({ rounded, scale }) {
  const offset = 256 * (1 - scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ""} fill="#ffffff"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
${PIG}
  </g>
</svg>`;
}

// "any": cantos arredondados. "maskable": tela cheia e o porquinho dentro da zona segura (o sistema recorta como quiser).
const ANY = svg({ rounded: true, scale: 0.92 });
const MASKABLE = svg({ rounded: false, scale: 0.68 });

const files = [
  { name: "icon-192.png", size: 192, svg: ANY },
  { name: "icon-512.png", size: 512, svg: ANY },
  { name: "icon-maskable-512.png", size: 512, svg: MASKABLE },
  // O iPhone arredonda sozinho: tela cheia
  { name: "apple-touch-icon.png", size: 180, svg: MASKABLE },
  { name: "favicon-32.png", size: 32, svg: ANY },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const file of files) {
  await page.setViewportSize({ width: file.size, height: file.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${file.svg.replace("<svg ", `<svg width="${file.size}" height="${file.size}" `)}</body></html>`,
  );
  await page.screenshot({ path: path.join(out, file.name), omitBackground: true });
  console.log("gerado", file.name);
}
await browser.close();

// O favicon em SVG fica na raiz de public/ (o navegador pede /favicon.svg): e o proprio SVG da marca
copyFileSync(brandSvg, path.join(root, "public", "favicon.svg"));
console.log("copiado favicon.svg");
