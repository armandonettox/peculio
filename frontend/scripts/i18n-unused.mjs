// Lista (e, com --prune, apaga) as chaves de traducao que nenhum codigo usa.
//   node scripts/i18n-unused.mjs            so lista
//   node scripts/i18n-unused.mjs --prune    apaga do pt-BR.json e do en.json
//
// Uma chave conta como usada se o codigo a escreve por inteiro ("a.b.c"), ou se escreve um prefixo dinamico
// (`labels.${kind}.title` usa todas as chaves que comecam com "labels." e terminam com ".title"), ou se e a forma
// de plural de uma chave usada (chave_one, chave_other, chave_zero).

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const LOCALES = path.join(SRC, "i18n", "locales");
const PRUNE = process.argv.includes("--prune");

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "locales" ? [] : files(child);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

const flatten = (tree, prefix = "") =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [prefix ? `${prefix}.${k}` : k] : flatten(v, prefix ? `${prefix}.${k}` : k)));
const pt = JSON.parse(fs.readFileSync(path.join(LOCALES, "pt-BR.json"), "utf-8"));
const keys = flatten(pt);

const exact = new Set();
const patterns = []; // [prefixo, sufixo]
for (const file of files(SRC)) {
  const text = fs.readFileSync(file, "utf-8");
  for (const m of text.matchAll(/["'`]([A-Za-z0-9_.$/{}\-\[\]a-zA-Z]+?)["'`]/g)) {
    const raw = m[1];
    if (raw.includes("${")) {
      // `labels.${config.kind}.title`: tudo ate o primeiro ${ e o que vem depois do ultimo }
      const prefix = raw.slice(0, raw.indexOf("${"));
      const suffix = raw.slice(raw.lastIndexOf("}") + 1);
      if (prefix) patterns.push([prefix, suffix]);
    } else if (raw.includes(".")) {
      exact.add(raw);
    }
  }
}

const base = (key) => key.replace(/_(zero|one|two|few|many|other)$/, "");
const used = (key) => {
  const b = base(key);
  return exact.has(key) || exact.has(b) || patterns.some(([prefix, suffix]) => b.startsWith(prefix) && b.endsWith(suffix));
};

const unused = keys.filter((key) => !used(key));
console.log(`${keys.length} chaves, ${unused.length} sem uso`);
for (const key of unused) console.log("  " + key);

if (PRUNE && unused.length) {
  for (const file of ["pt-BR.json", "en.json"]) {
    const p = path.join(LOCALES, file);
    const tree = JSON.parse(fs.readFileSync(p, "utf-8"));
    for (const key of unused) {
      const parts = key.split(".");
      let cursor = tree;
      for (const part of parts.slice(0, -1)) cursor = cursor?.[part];
      if (cursor) delete cursor[parts.at(-1)];
    }
    // Remove objetos que ficaram vazios
    const clean = (node) => {
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === "object") {
          clean(v);
          if (Object.keys(v).length === 0) delete node[k];
        }
      }
    };
    clean(tree);
    fs.writeFileSync(p, JSON.stringify(tree, null, 2) + "\n");
  }
  console.log(`apagadas ${unused.length} chaves`);
}
process.exit(unused.length && !PRUNE ? 2 : 0);
