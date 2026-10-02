FROM python:3.13-slim

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chmod +x docker-entrypoint.sh

# Pasta dos anexos dos lancamentos. O app roda como root neste container, entao ela ja e gravavel;
# em producao o docker-compose monta um volume aqui para os arquivos sobreviverem a novos builds.
RUN mkdir -p /data/attachments && chmod 750 /data/attachments

EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
