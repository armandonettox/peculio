import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

// Gera o dist/sw.js. Roda DEPOIS do build do app (npm run build): a versao do service worker vem do dist/index.html,
// que cita os arquivos com hash. Assim a versao so muda quando o app muda de verdade, e um deploy sem mudanca nao
// oferece "nova versao" a ninguem.
const indexPath = path.resolve(__dirname, "dist/index.html");
if (!existsSync(indexPath)) throw new Error("Rode o build do app antes: dist/index.html nao existe");
const buildId = createHash("sha256").update(readFileSync(indexPath)).digest("hex").slice(0, 12);

export default defineConfig({
  // O build do app ja esvaziou o dist e copiou a pasta public: aqui so se acrescenta o sw.js
  publicDir: false,
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    lib: { entry: path.resolve(__dirname, "src/sw/sw.ts"), formats: ["iife"], name: "FinanceAppWorker", fileName: () => "sw.js" },
  },
});
