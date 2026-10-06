// Extrai os textos fixos das telas para os arquivos de traducao (src/i18n/locales).
//
//   node scripts/i18n-extract.mjs <arquivos ou pastas...>            so mostra o que faria
//   node scripts/i18n-extract.mjs <arquivos ou pastas...> --write    aplica (troca o texto por t("chave") e grava no pt-BR.json)
//   --out arquivo.json                                              grava tambem as chaves novas (chave: texto) para traduzir
//
// Trata so o que e seguro automatizar: texto fixo dentro do JSX e atributos de texto (aria-label, title, placeholder...).
// O resto (texto misturado com variaveis, mensagens fora do JSX, plurais) vai para a lista "manual", sem mexer.
// O ingles (en.json) nao e tocado: quem traduz acrescenta as mesmas chaves la, e o teste de paridade confere.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const PT_FILE = path.join(SRC, "i18n", "locales", "pt-BR.json");
const WRITE = process.argv.includes("--write");
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex >= 0 ? process.argv[outIndex + 1] : null;
const targets = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith("--") && all[i - 1] !== "--out");

// Atributos cujo texto fixo e lido pela pessoa
const TEXT_ATTRS = new Set([
  "aria-label", "title", "placeholder", "alt", "label", "description", "hint", "caption", "note", "consequence",
  "emptyText", "aria-description", "aria-roledescription",
]);
// Atributos que nunca sao texto para a pessoa
const IGNORED_ATTRS = new Set([
  "className", "id", "key", "type", "name", "value", "href", "to", "role", "htmlFor", "variant", "size", "style", "ref",
  "data-testid", "lang", "dir", "autoComplete", "inputMode", "accept", "target", "rel", "src", "fill", "stroke", "d", "viewBox",
  "align", "side", "as", "asChild", "aria-keyshortcuts", "aria-controls", "aria-describedby", "aria-labelledby", "autoCapitalize", "mode", "kind", "tone", "color", "icon", "format",
]);

const norm = (text) => text.replace(/\s+/g, " ").trim();
const hasLetters = (text) => /\p{L}{2,}/u.test(text);

function listFiles(target) {
  const full = path.resolve(ROOT, target);
  const stat = fs.statSync(full);
  if (stat.isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(full, entry.name);
    if (entry.isDirectory()) return listFiles(path.relative(ROOT, child));
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [child] : [];
  });
}

function parse(file) {
  const text = fs.readFileSync(file, "utf-8");
  return { text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) };
}

// ---------- Contagem global (para juntar os textos repetidos em common.*) ----------
function collectTexts(sf) {
  const found = [];
  const visit = (node) => {
    if (ts.isJsxText(node) && !node.containsOnlyTriviaWhiteSpaces) {
      const text = norm(node.getText(sf));
      if (hasLetters(text) && !text.includes("&")) found.push(text);
    }
    if (ts.isJsxAttribute(node) && TEXT_ATTRS.has(node.name.getText(sf)) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const text = norm(node.initializer.text);
      if (hasLetters(text)) found.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function allSrcFiles(dir = SRC) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "i18n" ? [] : allSrcFiles(child);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [child] : [];
  });
}

const globalCount = new Map();
for (const file of allSrcFiles()) {
  for (const text of collectTexts(parse(file).sf)) globalCount.set(text, (globalCount.get(text) ?? 0) + 1);
}

// ---------- Chaves ----------
const camel = (words) => words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("");
function slugOf(text) {
  const words = text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).slice(0, 4);
  const slug = camel(words);
  return (slug || "text").slice(0, 30);
}
function prefixOf(file) {
  const rel = path.relative(SRC, file).replace(/\\/g, "/").replace(/\.tsx$/, "");
  const parts = rel.split("/");
  const base = camel(parts[parts.length - 1].split("-").map((p) => p.toLowerCase()));
  if (parts[0] === "features") return `${parts[1]}.${base}`;
  if (parts[0] === "pages") return `pages.${base}`;
  return `components.${base}`;
}

const pt = JSON.parse(fs.readFileSync(PT_FILE, "utf-8"));
const flatten = (tree, prefix = "") =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [[prefix ? `${prefix}.${k}` : k, v]] : flatten(v, prefix ? `${prefix}.${k}` : k)));
const existing = new Map(flatten(pt).map(([k, v]) => [k, v]));
const commonByText = new Map(flatten(pt).filter(([k]) => k.startsWith("common.")).map(([k, v]) => [v, k]));
const used = new Map(existing); // chave -> texto (as existentes e as novas desta rodada)

function keyFor(file, text) {
  if (commonByText.has(text)) return commonByText.get(text);
  const useCommon = (globalCount.get(text) ?? 0) >= 3 && text.length <= 40;
  const prefix = useCommon ? "common" : prefixOf(file);
  const slug = slugOf(text);
  for (let n = 1; ; n += 1) {
    const key = `${prefix}.${slug}${n === 1 ? "" : n}`;
    if (!used.has(key)) {
      used.set(key, text);
      if (useCommon) commonByText.set(text, key);
      return key;
    }
    if (used.get(key) === text) return key;
  }
}

// ---------- Processar um arquivo ----------
function enclosingComponent(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name && /^[A-Z]/.test(p.name.text)) return p;
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p))) {
      let q = p.parent;
      // forwardRef(...), memo(...)
      while (q && ts.isCallExpression(q)) q = q.parent;
      if (q && ts.isVariableDeclaration(q) && ts.isIdentifier(q.name) && /^[A-Z]/.test(q.name.text)) return p;
    }
  }
  return null;
}

function processFile(file) {
  const { text, sf } = parse(file);
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const edits = [];
  const manual = [];
  const newKeys = {};
  const needsHook = new Map(); // funcao -> true
  const handled = new Set(); // literais ja trocados por t()
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  function register(node, value, replacement) {
    const comp = enclosingComponent(node);
    if (!comp) {
      manual.push(`${rel}:${line(node)}  fora de um componente (use i18n.t): "${value}"`);
      return null;
    }
    const key = keyFor(file, value);
    newKeys[key] = value;
    needsHook.set(comp, true);
    return key;
  }

  function literalsIn(expr, nameForManual) {
    // so o que for texto fixo: o proprio literal, e os ramos de ?: e de &&/||/??
    const out = [];
    const walk = (e) => {
      if (ts.isParenthesizedExpression(e)) return walk(e.expression);
      if (ts.isConditionalExpression(e)) { walk(e.whenTrue); walk(e.whenFalse); return; }
      if (ts.isBinaryExpression(e) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) { walk(e.right); return; }
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) out.push(e);
      else if (ts.isTemplateExpression(e)) manual.push(`${rel}:${line(e)}  ${nameForManual}: texto com variaveis: ${e.getText(sf).slice(0, 90)}`);
    };
    walk(expr);
    return out;
  }

  const visit = (node) => {
    if (ts.isJsxText(node) && !node.containsOnlyTriviaWhiteSpaces) {
      const raw = node.getText(sf);
      const value = norm(raw);
      if (hasLetters(value)) {
        const parent = node.parent;
        // Um icone (elemento sem filhos) ao lado do texto nao mistura nada: o texto traduz sozinho
        const mixed = parent.children.some((c) => c !== node && !ts.isJsxText(c) && !ts.isJsxSelfClosingElement(c));
        if (raw.includes("&")) manual.push(`${rel}:${line(node)}  entidade HTML no texto: "${value.slice(0, 70)}"`);
        else if (mixed) manual.push(`${rel}:${line(node)}  texto misturado com variavel ou elemento: "${value.slice(0, 70)}"`);
        else {
          const key = register(node, value);
          if (key) {
            const lead = raw.length - raw.trimStart().length;
            const trail = raw.length - raw.trimEnd().length;
            edits.push({ start: node.getStart(sf) + lead, end: node.getEnd() - trail, text: `{t("${key}")}` });
          }
        }
      }
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      // Texto fixo dentro de {cond ? "A" : "B"} ou {cond && "A"} no meio dos filhos
      for (const lit of literalsIn(node.expression, "expressao")) {
        const value = norm(lit.text);
        if (!hasLetters(value)) continue;
        const key = register(node, value);
        if (key) {
          handled.add(lit);
          edits.push({ start: lit.getStart(sf), end: lit.getEnd(), text: `t("${key}")` });
        }
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      const init = node.initializer;
      if (TEXT_ATTRS.has(name) && init) {
        if (ts.isStringLiteral(init)) {
          const value = norm(init.text);
          if (hasLetters(value)) {
            const key = register(node, value);
            if (key) {
              handled.add(init);
              edits.push({ start: init.getStart(sf), end: init.getEnd(), text: `{t("${key}")}` });
            }
          }
        } else if (ts.isJsxExpression(init) && init.expression) {
          for (const lit of literalsIn(init.expression, name)) {
            const value = norm(lit.text);
            if (!hasLetters(value)) continue;
            const key = register(node, value);
            if (key) {
          handled.add(lit);
          edits.push({ start: lit.getStart(sf), end: lit.getEnd(), text: `t("${key}")` });
        }
          }
        }
      } else if (!IGNORED_ATTRS.has(name) && !name.startsWith("data-") && init && ts.isStringLiteral(init)) {
        const value = norm(init.text);
        if (/\s/.test(value) && hasLetters(value)) manual.push(`${rel}:${line(node)}  atributo nao listado ${name}="${value.slice(0, 60)}"`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Textos fora do JSX: so avisa
  const nonJsx = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      const skip = handled.has(node) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isJsxAttribute(p) || ts.isLiteralTypeNode(p) ||
        (ts.isPropertyAssignment(p) && p.name === node) || ts.isElementAccessExpression(p) || ts.isCaseClause(p) ||
        (ts.isCallExpression(p) && /^(t|require|import)$/.test(p.expression.getText(sf)));
      const value = norm(node.text);
      if (!skip && hasLetters(value) && /\s/.test(value) && /[A-ZÀ-Ú]/.test(value[0]) && !/^[a-z0-9\s\-_:./]+$/.test(value)) {
        manual.push(`${rel}:${line(node)}  mensagem fora do JSX: "${value.slice(0, 80)}"`);
      }
    }
    ts.forEachChild(node, nonJsx);
  };
  nonJsx(sf);

  // Gancho em cada componente que ganhou t()
  const hookEdits = [];
  for (const comp of needsHook.keys()) {
    const body = comp.body;
    if (!ts.isBlock(body)) { manual.push(`${rel}:${line(comp)}  componente com corpo em expressao: precisa de useTranslation a mao`); continue; }
    const bodyText = body.getText(sf);
    if (/const\s*\{[^}]*\bt\b[^}]*\}\s*=\s*useTranslation\(/.test(bodyText)) continue;
    const first = body.statements[0];
    const indent = first ? " ".repeat(sf.getLineAndCharacterOfPosition(first.getStart(sf)).character) : "  ";
    hookEdits.push({ start: body.getStart(sf) + 1, end: body.getStart(sf) + 1, text: `\n${indent}const { t } = useTranslation();` });
  }
  edits.push(...hookEdits);

  // Import
  if (needsHook.size > 0 && !/from\s+["']react-i18next["']/.test(text)) {
    const imports = sf.statements.filter(ts.isImportDeclaration);
    const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
    edits.push({ start: at, end: at, text: `\nimport { useTranslation } from "react-i18next";` });
  }

  return { file, rel, text, edits, manual, newKeys };
}

// ---------- Rodar ----------
if (targets.length === 0) {
  console.error("Uso: node scripts/i18n-extract.mjs <arquivos ou pastas...> [--write] [--out pendentes.json]");
  process.exit(1);
}
const files = [...new Set(targets.flatMap(listFiles))];
const results = files.map(processFile);

const allNew = Object.assign({}, ...results.map((r) => r.newKeys));
const nested = structuredClone(pt);
for (const [key, value] of Object.entries(allNew)) {
  const parts = key.split(".");
  let cursor = nested;
  parts.slice(0, -1).forEach((part) => {
    if (typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
}

let totalEdits = 0;
for (const r of results) {
  const changed = r.edits.length > 0;
  totalEdits += r.edits.filter((e) => e.text.startsWith("{t(") || e.text.startsWith("t(")).length;
  if (WRITE && changed) {
    let out = r.text;
    for (const e of [...r.edits].sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    fs.writeFileSync(r.file, out);
  }
}
if (WRITE) fs.writeFileSync(PT_FILE, JSON.stringify(nested, null, 2) + "\n");
if (OUT) fs.writeFileSync(OUT, JSON.stringify(allNew, null, 2) + "\n");

console.log(`${WRITE ? "APLICADO" : "SIMULACAO"}: ${files.length} arquivos, ${totalEdits} textos trocados, ${Object.keys(allNew).length} chaves novas`);
const manual = results.flatMap((r) => r.manual);
console.log(`\nMANUAL (${manual.length}) - precisam de decisao:`);
for (const line of manual) console.log("  " + line);
