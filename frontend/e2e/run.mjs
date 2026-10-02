// Sobe a stack completa num projeto Docker Compose descartavel, roda o Playwright e
// derruba tudo no final (mesmo se os testes falharem). Uso: npm run e2e
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendDir, "..");
const project = `finance-e2e-${randomUUID().slice(0, 8)}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const secret = () => randomBytes(48).toString("base64url");
const env = {
  ...process.env,
  POSTGRES_USER: "finance",
  POSTGRES_PASSWORD: secret(),
  POSTGRES_DB: "finance",
  JWT_SECRET: secret(),
  ENCRYPTION_KEY: secret(),
  FRONTEND_PORT: String(port),
  // O E2E entra varias vezes por minuto do mesmo IP; so aqui o limite fica desligado
  RATE_LIMIT_ENABLED: "false",
  // O receptor do E2E dos webhooks roda na maquina de teste (destino local); so aqui isso e liberado
  WEBHOOK_ALLOW_PRIVATE: "true",
  // Entrega rapida para o teste nao esperar os 30 s do padrao
  WEBHOOK_INTERVAL_SECONDS: "2",
  E2E_BASE_URL: `http://localhost:${port}`,
};

function run(command, args, options = {}) {
  return spawnSync(command, args, { stdio: "inherit", env, shell: process.platform === "win32", ...options });
}

function compose(...args) {
  return run("docker", ["compose", "-p", project, "-f", path.join(repoRoot, "docker-compose.yml"), ...args], {
    cwd: repoRoot,
  });
}

let exitCode = 1;
let cleaned = false;

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  console.log(`\nDerrubando a stack ${project}...`);
  // -v remove o volume do banco de teste; --rmi local remove as imagens construidas aqui
  compose("down", "-v", "--rmi", "local");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

try {
  console.log(`Subindo a stack ${project} em http://localhost:${port} ...`);
  const up = compose("up", "-d", "--build", "--wait");
  if (up.status !== 0) {
    console.error("Nao foi possivel subir a stack.");
  } else {
    const result = run("npx", ["playwright", "test", ...process.argv.slice(2)], { cwd: frontendDir });
    exitCode = result.status ?? 1;
  }
} finally {
  cleanup();
}
process.exit(exitCode);
