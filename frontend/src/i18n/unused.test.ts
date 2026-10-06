import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

// Chave de traducao que nenhum codigo usa e lixo: alguem troca a frase e esquece a chave velha, e o idioma novo
// ainda teria que traduzi-la. scripts/i18n-unused.mjs lista as orfas (e apaga com --prune).
it("nenhuma chave de traducao ficou sem uso", () => {
  const script = path.resolve(__dirname, "../../scripts/i18n-unused.mjs");
  let output = "";
  try {
    output = execFileSync(process.execPath, [script], { encoding: "utf-8" });
  } catch (error) {
    output = String((error as { stdout?: string }).stdout ?? error);
    throw new Error(`Chaves sem uso (rode: node scripts/i18n-unused.mjs --prune):\n${output}`);
  }
  expect(output).toMatch(/\b0 sem uso/);
});
