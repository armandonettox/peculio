// Junta traducoes (um JSON plano "chave.completa": "texto") ao src/i18n/locales/en.json.
//   node scripts/i18n-merge-en.mjs traducoes.json
// So aceita chave que existe no pt-BR.json (evita erro de digitacao) e nao sobrescreve em silencio uma traducao
// diferente: avisa e para, a nao ser que se passe --overwrite.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const LOCALES = path.join(ROOT, "src", "i18n", "locales");
const input = process.argv[2];
const overwrite = process.argv.includes("--overwrite");
if (!input) {
  console.error("Uso: node scripts/i18n-merge-en.mjs traducoes.json [--overwrite]");
  process.exit(1);
}

const read = (file) => JSON.parse(fs.readFileSync(path.join(LOCALES, file), "utf-8"));
const flatten = (tree, prefix = "") =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [[prefix ? `${prefix}.${k}` : k, v]] : flatten(v, prefix ? `${prefix}.${k}` : k)));

const pt = new Map(flatten(read("pt-BR.json")));
const en = read("en.json");
const enFlat = new Map(flatten(en));
const incoming = JSON.parse(fs.readFileSync(path.resolve(input), "utf-8"));

const problems = [];
for (const [key, text] of Object.entries(incoming)) {
  if (!pt.has(key)) problems.push(`chave desconhecida no pt-BR: ${key}`);
  else if (typeof text !== "string" || !text.trim()) problems.push(`texto vazio: ${key}`);
  else if (enFlat.has(key) && enFlat.get(key) !== text && !overwrite) problems.push(`ja existe outra traducao (use --overwrite): ${key}`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

for (const [key, text] of Object.entries(incoming)) {
  const parts = key.split(".");
  let cursor = en;
  for (const part of parts.slice(0, -1)) {
    if (typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = text;
}
fs.writeFileSync(path.join(LOCALES, "en.json"), JSON.stringify(en, null, 2) + "\n");

const missing = [...pt.keys()].filter((key) => !flatten(en).some(([k]) => k === key));
console.log(`${Object.keys(incoming).length} traducoes gravadas. Faltam ${missing.length} chaves no ingles.`);
