# Deploy do Pecúlio na VPS

O Pecúlio roda na mesma VM Oracle do hera, hermes e verbo, em um projeto e um pod próprios
(`pod_peculio`), atrás do Cloudflare em `peculio.armandonetto.com`.

```
visitante -> Cloudflare -> nginx do host (443) -> container frontend (127.0.0.1:8035)
                                                      |-> arquivos do React
                                                      |-> /api -> container backend (:8000)
                                                                     |-> container db (postgres, :5432, so interno)
```

## O que o deploy automático faz

O workflow `.github/workflows/deploy.yml` roda quando o workflow `testes` passa na `main`
(ou manualmente em Actions > deploy > Run workflow):

1. Constrói as imagens do backend e do frontend para ARM64 e envia ao GHCR
   (`ghcr.io/armandonettox/peculio-backend` e `peculio-frontend`, tag com os 12 primeiros
   caracteres do commit).
2. Entra na VPS por SSH, envia `docker-compose.yml` e `deploy/`, baixa as imagens e reinicia
   o Pecúlio (`peculio-compose.service`). O backend aplica as migrations do Alembic sozinho
   ao subir (`docker-entrypoint.sh`).
3. Confere a saúde por até 90 s (`/` e `/api/health`). Se falhar, volta para as imagens
   anteriores e o job termina com erro.
4. Sincroniza a config do nginx do host, mas só se o certificado do Cloudflare já existir, e
   desfaz a cópia se o `nginx -t` falhar, para não quebrar o nginx dos outros sites.
5. Apaga imagens antigas, mantendo a atual e a anterior.

O script nunca mexe no pod do hera nem no do verbo, e não mata o `aardvark-dns`.

## Passos manuais, uma única vez

Estes passos mudam a VPS e o GitHub. Faça na ordem.

### 1. Cloudflare

Já feito: o DNS (`peculio` apontando para o mesmo destino do hera, proxy ligado) e o
Origin Certificate wildcard já existem (compartilhados com hera/hermes/verbo). Nada a fazer
aqui.

### 2. VPS

```bash
mkdir -p ~/peculio
# segredos da aplicacao (nao versionados, nao enviar para o git)
umask 077 && cat > ~/peculio/.env <<'EOF'
POSTGRES_USER=peculio
POSTGRES_PASSWORD=cole_uma_senha_forte_aqui
POSTGRES_DB=peculio
JWT_SECRET=cole_um_valor_aleatorio_longo_aqui
ENCRYPTION_KEY=cole_outro_valor_aleatorio_longo_aqui
COOKIE_SECURE=true
EOF
```

Gerar valores aleatórios fortes para `JWT_SECRET`/`ENCRYPTION_KEY`/`POSTGRES_PASSWORD`:
`openssl rand -base64 32`.

### 3. Secrets do GitHub

Em Settings > Secrets and variables > Actions, no repositório `peculio`:

| Secret | Valor |
|--------|-------|
| `VPS_HOST` | IP público (reservado) da VM |
| `VPS_USER` | usuário SSH da VM |
| `VPS_SSH_KEY` | chave privada dedicada ao deploy do Pecúlio (não reutiliza a do hera nem a do verbo) |
| `VPS_KNOWN_HOSTS` | saída de `ssh-keyscan -t ed25519 IP_DA_VPS`, conferida com a impressão digital do servidor antes de salvar |

A chave pública do par vai em `~/.ssh/authorized_keys` da VM. O usuário precisa de `sudo` sem
senha (o hera já depende disso) para o nginx do host.

### 4. Primeiro deploy

Rode manualmente o workflow `deploy` e acompanhe o log. Depois confira:

```bash
curl -s http://127.0.0.1:8035/api/health   # na VPS
curl -sI https://peculio.armandonetto.com/ # de fora
```

## Servidor padrão da VPS

`00-padrao-redirect.conf` já está instalado em `/etc/nginx/conf.d/` (pelo deploy do verbo) e
atende, na porta 443, qualquer nome que não tenha bloco próprio, redirecionando (302) para
`https://armandonetto.com/`. O deploy do Pecúlio não mexe nesse arquivo, só no seu próprio
(`peculio.armandonetto.com.conf`).

## Operação

- Ver o estado: `podman ps --filter name=peculio` e `journalctl --user -u peculio-compose.service`.
- Reiniciar: `systemctl --user restart peculio-compose.service`. Não use `podman rm -f` em um
  container solto: no podman-compose isso derruba a rede dos outros do mesmo pod.
- Rollback manual: copie `~/peculio/.env.imagens.anterior` para `~/peculio/.env.imagens` e
  reinicie o serviço.
- Backup do banco: `podman exec peculio_db_1 pg_dump -U peculio peculio | gzip > backup.sql.gz`
  (confira o nome exato do container com `podman ps`).

## Riscos conhecidos

- No podman-compose desta VM os containers do mesmo pod não compartilham a rede: o frontend
  chega no backend pelo nome (`backend`, via aardvark-dns), não por `127.0.0.1`. O nginx do
  frontend resolve esse nome a cada requisição (`frontend/nginx.conf.template`): sem isso,
  quando o backend reiniciava e ganhava outro IP, o frontend ficava com 502 até ser
  reiniciado também (mesmo problema já visto no verbo).
- As checagens de saúde do podman não rodam para containers subidos pela unit do systemd
  (o status fica em `starting`). A saúde real é conferida por HTTP no script de deploy.
- O rate limit por IP depende de o nginx do host mandar `X-Real-IP` com o valor de
  `CF-Connecting-IP`. Sem isso, todos os visitantes dividem o mesmo limite.
