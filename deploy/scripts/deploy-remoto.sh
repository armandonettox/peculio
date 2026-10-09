#!/usr/bin/env bash
# Roda na VPS, chamado pelo workflow de deploy (.github/workflows/deploy.yml).
#
# Uso: bash deploy-remoto.sh <tag-da-imagem> <usuario-ghcr>
# O token do GHCR chega pela entrada padrao (primeira linha), para nao aparecer em
# lista de processos nem em log.
#
# Este script nunca mexe no pod do hera nem no do verbo, e nao mata o aardvark-dns: ele e
# global na VM e matar o processo pode derrubar a rede dos outros projetos.

set -euo pipefail

TAG="${1:?informe a tag da imagem}"
USUARIO_GHCR="${2:?informe o usuario do GHCR}"
read -r TOKEN_GHCR

if [[ ! "$TAG" =~ ^[0-9a-f]{7,40}$ ]]; then
    echo "Tag invalida: $TAG"
    exit 1
fi

IMAGEM_BACKEND="ghcr.io/armandonettox/peculio-backend"
IMAGEM_FRONTEND="ghcr.io/armandonettox/peculio-frontend"
DIR="$HOME/peculio"

export PATH="$PATH:$HOME/.local/bin"
XDG_RUNTIME_DIR="/run/user/$(id -u)"
export XDG_RUNTIME_DIR
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"

cd "$DIR"

echo "=== Conferindo pre-requisitos ==="
if [ ! -f .env ]; then
    echo "Falta ~/peculio/.env com POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, JWT_SECRET e ENCRYPTION_KEY (ver deploy/README.md)"
    exit 1
fi
DISCO_LIVRE_GB=$(df --output=avail -BG "$HOME" | tail -1 | tr -dc '0-9')
if [ "$DISCO_LIVRE_GB" -lt 3 ]; then
    echo "Pouco espaco em disco (${DISCO_LIVRE_GB}G livres); abortando"
    exit 1
fi

echo "=== Baixando as imagens ($TAG) ==="
trap 'podman logout ghcr.io >/dev/null 2>&1 || true' EXIT
printf '%s' "$TOKEN_GHCR" | podman login ghcr.io -u "$USUARIO_GHCR" --password-stdin
podman pull "$IMAGEM_BACKEND:$TAG"
podman pull "$IMAGEM_FRONTEND:$TAG"

echo "=== Instalando a unit do systemd ==="
mkdir -p "$HOME/.config/systemd/user"
cp deploy/systemd/peculio-compose.service "$HOME/.config/systemd/user/peculio-compose.service"
systemctl --user daemon-reload
systemctl --user enable peculio-compose.service 2>/dev/null || true

# Guarda as imagens atuais para voltar se a nova nao ficar saudavel
if [ -f .env.imagens ]; then
    cp .env.imagens .env.imagens.anterior
fi
cat > .env.imagens <<EOF
PECULIO_BACKEND_IMAGE=$IMAGEM_BACKEND:$TAG
PECULIO_FRONTEND_IMAGE=$IMAGEM_FRONTEND:$TAG
EOF

reiniciar() {
    systemctl --user stop peculio-compose.service 2>/dev/null || true
    # pausa entre derrubar e subir: o podman-compose rootless as vezes deixa a rede presa
    # quando o down e o up vem colados
    sleep 5
    systemctl --user start peculio-compose.service
}

saudavel() {
    local tentativa
    for tentativa in $(seq 1 18); do
        sleep 5
        if curl -sf http://127.0.0.1:8035/ >/dev/null && curl -sf http://127.0.0.1:8035/api/health >/dev/null; then
            return 0
        fi
        echo "Tentativa $tentativa: ainda nao saudavel"
    done
    return 1
}

echo "=== Reiniciando o peculio ==="
reiniciar

echo "=== Verificando a saude ==="
if ! saudavel; then
    echo "SAUDE FALHOU depois de varias tentativas"
    podman ps -a --filter name=peculio --format '{{.Names}} {{.Status}}' || true
    if [ -f .env.imagens.anterior ]; then
        echo "Voltando para as imagens anteriores"
        cp .env.imagens.anterior .env.imagens
        reiniciar
        saudavel || echo "As imagens anteriores tambem nao ficaram saudaveis"
    fi
    exit 1
fi

echo "Saude: $(curl -sf http://127.0.0.1:8035/api/health)"

sincronizar_nginx() {
    # o peculio reaproveita o certificado wildcard do hera
    local base="/etc/ssl/cloudflare/hera.armandonetto.com"
    if ! sudo test -f "$base.pem" || ! sudo test -f "$base.key"; then
        echo "Certificado wildcard do Cloudflare nao encontrado em /etc/ssl/cloudflare; pulando o nginx do host"
        return 0
    fi

    sudo mkdir -p /usr/share/nginx/peculio-erros
    sudo cp deploy/nginx/erros/50x.html /usr/share/nginx/peculio-erros/erro-50x.html

    local destino="/etc/nginx/conf.d/peculio.armandonetto.com.conf"
    local copia=""
    if sudo test -f "$destino"; then
        copia=$(mktemp)
        sudo cp "$destino" "$copia"
    fi
    sudo cp deploy/nginx/peculio.armandonetto.com.conf "$destino"

    # Um nginx -t quebrado afetaria todos os sites da VPS (hera, hermes, novo e verbo), entao a
    # configuracao anterior volta se o teste nao passar
    if sudo nginx -t; then
        sudo nginx -s reload
    else
        echo "nginx -t falhou; restaurando a configuracao anterior"
        if [ -n "$copia" ]; then
            sudo cp "$copia" "$destino"
        else
            sudo rm -f "$destino"
        fi
        return 1
    fi
}

echo "=== Sincronizando o nginx do host ==="
sincronizar_nginx

echo "=== Limpando imagens antigas ==="
ANTERIOR=""
if [ -f .env.imagens.anterior ]; then
    ANTERIOR=$(sed -n 's/^PECULIO_BACKEND_IMAGE=.*://p' .env.imagens.anterior)
fi
podman images --format '{{.Repository}}:{{.Tag}}' \
    | grep -E '^ghcr\.io/armandonettox/peculio-(backend|frontend):' \
    | while read -r imagem; do
        tag_da_imagem="${imagem##*:}"
        if [ "$tag_da_imagem" != "$TAG" ] && [ "$tag_da_imagem" != "$ANTERIOR" ]; then
            podman rmi "$imagem" >/dev/null 2>&1 || true
        fi
    done || true

echo "Deploy concluido: $TAG"
