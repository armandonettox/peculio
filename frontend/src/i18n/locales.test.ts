import { describe, expect, it } from "vitest";

import en from "./locales/en.json";
import ptBR from "./locales/pt-BR.json";

// Os dois arquivos de traducao precisam ter exatamente as mesmas chaves e os mesmos espacos reservados ({{nome}}).
// Uma chave que falta em ingles apareceria em portugues no meio de uma tela inglesa; um espaco reservado errado
// mostraria "{{count}}" ou perderia o numero.

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const pt = flatten(ptBR as Tree);
const english = flatten(en as Tree);
const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1]).sort();

describe("arquivos de traducao", () => {
  it("o ingles tem todas as chaves do portugues", () => {
    expect(Object.keys(pt).filter((key) => !(key in english))).toEqual([]);
  });

  it("o ingles nao tem chave sobrando", () => {
    expect(Object.keys(english).filter((key) => !(key in pt))).toEqual([]);
  });

  it("nenhum texto esta vazio", () => {
    expect(Object.entries(pt).filter(([, text]) => !text.trim()).map(([key]) => key)).toEqual([]);
    expect(Object.entries(english).filter(([, text]) => !text.trim()).map(([key]) => key)).toEqual([]);
  });

  it("os espacos reservados sao os mesmos nos dois idiomas", () => {
    const different = Object.keys(pt)
      .filter((key) => key in english && placeholders(pt[key]).join() !== placeholders(english[key]).join())
      .map((key) => `${key}: pt ${placeholders(pt[key])} / en ${placeholders(english[key])}`);
    expect(different).toEqual([]);
  });

  it("o ingles nao ficou com letras acentuadas do portugues por esquecimento", () => {
    // Texto em ingles quase nunca tem estes caracteres; se tiver, e sinal de traducao esquecida
    const suspicious = Object.entries(english)
      .filter(([, text]) => /[ãõçáéíóúâêôà]/i.test(text))
      .map(([key]) => key);
    expect(suspicious).toEqual([]);
  });
});
