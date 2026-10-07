"""Traducao dos poucos textos que o servidor gera de verdade: o motivo de cada linha do extrato que nao
entrou, o aviso de teste do webhook e o CSV exportado. O resto da API devolve so um ErrorCode e o frontend
traduz por ele (`errors.<codigo>` nos dois idiomas); aqui o texto em si viaja no corpo da resposta ou no
arquivo, entao precisa ja vir no idioma certo.

A regra de idioma e a mesma do frontend: portugues (de qualquer pais) vira pt-BR, qualquer outro idioma
vira en-US, e a falta do cabecalho (um script com token de API, por exemplo) cai no idioma de origem do
app, pt-BR.
"""

from typing import Literal

from fastapi import Request

Lang = Literal["pt-BR", "en-US"]


def resolve_lang(accept_language: str | None) -> Lang:
    if not accept_language:
        return "pt-BR"
    return "pt-BR" if accept_language.strip().lower().startswith("pt") else "en-US"


def get_lang(request: Request) -> Lang:
    """Dependencia do FastAPI: o idioma desta requisicao, pelo cabecalho Accept-Language."""
    return resolve_lang(request.headers.get("accept-language"))


def pick(lang: Lang, pt: str, en: str) -> str:
    """O texto no idioma da requisicao. Fica ao lado de onde a mensagem e usada, como o resto do
    codigo sempre fez com o portugues sozinho."""
    return pt if lang == "pt-BR" else en
