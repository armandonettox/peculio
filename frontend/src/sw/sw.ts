import { registerWorker, type WorkerScope } from "./worker";

// Preenchido pelo vite.sw.config.ts na hora do build: muda so quando o app muda
declare const __BUILD_ID__: string;

registerWorker({
  scope: self as unknown as WorkerScope,
  caches,
  fetch: (input, init) => fetch(input, init),
  buildId: __BUILD_ID__,
});
