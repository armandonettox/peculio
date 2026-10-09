FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine

# O .template recebe as variaveis de ambiente (BACKEND_URL, NGINX_LOCAL_RESOLVERS) quando o
# container sobe, via o entrypoint padrao da imagem do nginx (envsubst em /etc/nginx/templates/*.template)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Nome do servico no docker-compose local; em producao o deploy sobrescreve com o nome do
# servico no podman-compose (ver docker-compose.yml)
ENV BACKEND_URL=http://backend:8000
# Faz a imagem preencher NGINX_LOCAL_RESOLVERS com o DNS do container, usado no `resolver`
# do nginx.conf.template para resolver o backend a cada requisicao
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

EXPOSE 80
