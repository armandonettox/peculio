// Gera os icones do app (PWA) a partir da carteira da marca provisoria. Roda uma vez e os arquivos ficam no repositorio:
//   node scripts/make-icons.mjs
// Usa o Chromium do Playwright so para transformar SVG em PNG.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "icons");
mkdirSync(out, { recursive: true });

const NAVY = "#1e3a6b";

// A carteira do lucide (a mesma da marca no menu lateral), desenhada em 24x24
const WALLET = `
  <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>
  <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>`;

// Tudo desenhado numa tela de 512: `scale` diz quanto a carteira de 24 unidades cresce
function svg({ rounded, scale }) {
  const offset = (512 - 24 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ""} fill="${NAVY}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${WALLET}
  </g>
</svg>`;
}

// "any": cantos arredondados. "maskable": tela cheia e a carteira dentro da zona segura (o sistema recorta como quiser).
const ANY = svg({ rounded: true, scale: 14 });
const MASKABLE = svg({ rounded: false, scale: 11 });

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

// O favicon em SVG fica na raiz de public/ (o navegador pede /favicon.svg)
writeFileSync(path.join(root, "public", "favicon.svg"), ANY.replace(" viewBox", ' width="64" height="64" viewBox'));
console.log("gerado favicon.svg");
