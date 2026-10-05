# Segurança

O Pecúlio guarda dados financeiros pessoais, então segurança é tratada como requisito, não como detalhe. Este arquivo diz como relatar um problema, o que o app já faz para se proteger e o que quem instala precisa fazer do lado de fora.

## Versões que recebem correção

O projeto ainda não tem versão 1.0. Até lá, só a versão mais recente da branch principal recebe correções de segurança. Depois do 1.0, esta tabela passa a listar as versões mantidas.

## Como relatar uma vulnerabilidade

**Não abra uma issue pública** para um problema de segurança. Uma issue pública avisa todo mundo antes de existir correção.

Use o relato privado de vulnerabilidades do GitHub: na página do repositório, aba **Security**, botão **Report a vulnerability**. Só você e quem mantém o projeto veem o relato.

> Enquanto o repositório não estiver publicado no GitHub, este canal ainda não existe. Quando o repositório for criado, o relato privado precisa ser ligado em *Settings > Code security*, e esta frase deve ser removida.

Para ajudar a reproduzir, conte:

- o que você encontrou e qual o efeito (ler dados de outra pessoa, passar pelo login, executar algo no servidor...);
- os passos para reproduzir, com a versão ou o commit;
- se há alguma condição especial (2FA ligado, token de API, configuração do `.env`...).

Use sempre dados fictícios nos exemplos. Não inclua dados financeiros reais de ninguém.

### O que esperar

Metas, sem garantia, já que o projeto é mantido por uma pessoa:

- confirmar o recebimento em até 7 dias;
- avaliar e responder se é um problema real em até 30 dias;
- corrigir primeiro e divulgar depois, combinando a data com quem relatou, e dar o crédito se a pessoa quiser.

### Dentro e fora do alcance

Dentro: falhas no código deste repositório, nas imagens Docker que ele monta e na configuração padrão que ele entrega.

Fora: ataque que exige acesso físico ao servidor, instalação com a senha do banco ou os segredos do `.env` vazados, falta de HTTPS na instalação de quem hospeda, e vulnerabilidades em software de terceiros sem uma forma de explorá-las através do Pecúlio (relate ao projeto de origem).

## O que o app já faz

- **Senhas** guardadas com bcrypt. O tempo de resposta do login não revela se um e-mail existe.
- **Limite de tentativas:** o login e o cadastro têm limite de requisições, e a conta é bloqueada por 15 minutos depois de 5 erros seguidos de senha ou de código.
- **Verificação em duas etapas (2FA)** por aplicativo autenticador, com códigos de recuperação guardados só como hash. O segredo do 2FA fica cifrado no banco.
- **Sessão:** o token de acesso vale 60 minutos e é renovado enquanto a pessoa usa o app, com um teto de 168 horas. Trocar a senha encerra na hora todas as outras sessões. Hoje o token fica só na memória da aba.
- **Cadastro só por convite.** O primeiro usuário vira administrador; os demais entram com um convite de uso único, para um e-mail específico, que vence em 7 dias.
- **Tokens de API** (`fin_...`) guardados só como hash, com escopo de leitura ou de escrita. Ações sensíveis (criar tokens, mexer em 2FA, trocar a senha, editar o contato de segurança, criar convites) só valem pelo login da tela, nunca por token de API.
- **Webhooks** só para endereços `https` públicos por padrão, para não servirem de ponte para a rede interna (SSRF).
- **Cabeçalhos de segurança** no servidor web: política de conteúdo (CSP) que só aceita scripts do próprio endereço, proteção contra a página ser aberta em iframe, `nosniff` e política de referência fechada.
- **Dependências com versão fixa** no backend e auditoria de vulnerabilidades conhecidas (`pip-audit` e `npm audit`) a cada atualizacao de dependencia e antes de cada versao.
- **Segredos só no `.env`.** Em modo `production`, o backend se recusa a subir com os segredos de exemplo ou com segredos curtos.

## Se você hospeda o Pecúlio

1. **Gere segredos próprios** no `.env` (`JWT_SECRET` e `ENCRYPTION_KEY`, com `python -c "import secrets; print(secrets.token_urlsafe(48))"`) e troque a senha do banco. Nunca commite o `.env`.
2. **Use HTTPS.** O app não termina TLS sozinho: ponha um proxy reverso (Caddy, Traefik, nginx) na frente, com certificado. Sem HTTPS a senha e o token passam em texto aberto, e o app instalado (PWA) só funciona fora de `localhost` com HTTPS.
3. **Ligue o HSTS no proxy** depois que o HTTPS estiver funcionando (`Strict-Transport-Security`). O Pecúlio não o envia, porque quem sabe se há HTTPS é o proxy.
4. **Repasse o IP real.** O limite de tentativas usa o IP de quem conectou. Se houver um proxy na frente do nginx do Pecúlio, ajuste `proxy_set_header X-Forwarded-For` no `frontend/nginx.conf` para repassar o IP do proxy, senão todo mundo parece vir do mesmo endereço.
5. **Faça backup** do banco e do volume de anexos (`attachments_data`), e teste restaurar.
6. **Mantenha tudo atualizado:** as imagens base (`python:3.13-slim`, `nginx:alpine`, `postgres:17-alpine`) e o próprio Pecúlio. Reconstrua as imagens de tempos em tempos (`docker compose build --pull`).
7. **Defina o contato de segurança da sua instalação** em *Configurações > Contato de segurança* (só o administrador vê). Ele aparece na página Segurança para quem usa o app e é publicado em `/.well-known/security.txt`, o endereço que pesquisadores de segurança procuram.

## Atualizando as dependências

As versões do backend ficam fixas em `backend/requirements.txt`. Para atualizar de propósito:

1. troque as versões (a lista vem de um Python 3.13 limpo, o mesmo da imagem);
2. rode a auditoria: `pip-audit -r requirements.txt --no-deps --disable-pip` (o `--no-deps` evita compilar o `uvloop` no Windows);
3. rode os testes do backend e o E2E: `npm run e2e` em `frontend`;
4. no frontend, `npm audit` e `npm run build`.

## Política de divulgação

Correção primeiro, divulgação depois. Quando a correção sair, o aviso vai nas notas da versão e, se couber, num *GitHub Security Advisory* com o crédito de quem relatou.
