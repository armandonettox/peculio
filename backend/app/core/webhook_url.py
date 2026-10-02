import ipaddress
import socket
from collections.abc import Callable
from urllib.parse import urlsplit

from app.core.config import settings

# Recebe o nome do host e devolve os IPs (texto) para onde ele aponta. Trocavel nos testes.
Resolver = Callable[[str], list[str]]

MAX_URL_LENGTH = 2048


class WebhookUrlError(ValueError):
    """URL recusada. A mensagem e em portugues, sem acento, e pode ir direto para o usuario."""


def default_resolver(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise WebhookUrlError("Nao foi possivel resolver o endereco do host") from error
    # sockaddr[0] e o IP (em IPv6 pode vir com "%interface", que removemos)
    return sorted({str(info[4][0]).split("%")[0] for info in infos})


def is_blocked_ip(value: str) -> bool:
    """Verdadeiro para IP que nao deve receber webhook: privado, loopback, link-local (inclui o
    169.254.169.254 dos servicos de metadata da nuvem), reservado, multicast, nao especificado ou
    qualquer endereco nao publico (ex: 100.64.0.0/10). IPv4 dentro de IPv6 (::ffff:a.b.c.d) vale
    como o IPv4. Texto que nao e IP conta como bloqueado."""
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return True
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
        or not ip.is_global
    )


def validate_webhook_url(
    url: str, resolver: Resolver | None = None, allow_private: bool | None = None
) -> list[str]:
    """Levanta WebhookUrlError se a URL nao pode receber webhooks. Se pode, devolve os IPs validados.

    Regras: so http/https, sem usuario e senha na URL, e (a menos que WEBHOOK_ALLOW_PRIVATE esteja
    ligado) so https e so para host cujos IPs sejam todos publicos. O DNS e resolvido aqui, uma
    unica vez, e todos os IPs sao conferidos.

    DNS rebinding: a entrega NAO deixa o httpx resolver o nome de novo. Ela se conecta a um dos IPs
    devolvidos aqui (ver PinnedTransport em services/webhook_delivery.py), mantendo o nome original
    no Host, no SNI e na verificacao do certificado. Assim o IP validado e o IP usado, e nao ha
    janela entre a checagem e a conexao. A lista e vazia quando nao ha o que fixar: com
    WEBHOOK_ALLOW_PRIVATE ligado nao se consulta o DNS. O httpx tambem nao segue redirecionamentos.
    """
    if allow_private is None:
        allow_private = settings.webhook_allow_private
    if len(url) > MAX_URL_LENGTH:
        raise WebhookUrlError("Endereco muito longo")
    try:
        parts = urlsplit(url)
        host = parts.hostname
        parts.port  # noqa: B018 - levanta ValueError se a porta for invalida
    except ValueError as error:
        raise WebhookUrlError("Endereco invalido") from error
    if parts.scheme not in ("http", "https"):
        raise WebhookUrlError("O endereco precisa comecar com http:// ou https://")
    if not host:
        raise WebhookUrlError("Endereco sem host")
    if parts.username is not None or parts.password is not None:
        raise WebhookUrlError("O endereco nao pode ter usuario e senha")
    if parts.scheme == "http" and not allow_private:
        raise WebhookUrlError("Use https:// (http so e aceito com WEBHOOK_ALLOW_PRIVATE ligado)")
    if allow_private:
        return []

    try:
        ipaddress.ip_address(host)
        # Host ja e um IP: nao ha DNS para consultar
        addresses = [host]
    except ValueError:
        addresses = (resolver or default_resolver)(host)
    if not addresses:
        raise WebhookUrlError("Nao foi possivel resolver o endereco do host")
    if any(is_blocked_ip(address) for address in addresses):
        raise WebhookUrlError("O endereco aponta para uma rede interna ou reservada")
    return list(addresses)
