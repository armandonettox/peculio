import pytest

from app.core.webhook_url import WebhookUrlError, is_blocked_ip, validate_webhook_url
from tests.webhook_support import fake_resolver, no_real_dns  # noqa: F401


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "127.5.5.5",
        "10.0.0.1",
        "10.255.255.255",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.0.1",
        "169.254.169.254",
        "::1",
        "fc00::1",
        "fd12:3456::1",
        "fe80::1",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
        "::ffff:169.254.169.254",
        "0.0.0.0",
        "::",
        "224.0.0.1",
        "ff02::1",
        "240.0.0.1",
        "100.64.0.1",
        "nao-e-ip",
    ],
)
def test_blocked_ips(ip):
    assert is_blocked_ip(ip) is True


@pytest.mark.parametrize("ip", ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])
def test_public_ips_are_allowed(ip):
    assert is_blocked_ip(ip) is False


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1/hook",
        "https://10.1.2.3/hook",
        "https://172.16.5.5/hook",
        "https://192.168.1.1/hook",
        "https://169.254.169.254/latest/meta-data",
        "https://[::1]/hook",
        "https://[fc00::1]/hook",
        "https://[::ffff:127.0.0.1]/hook",
        "https://0.0.0.0/hook",
        "https://localhost/hook",
        # Nome que resolve para IP privado
        "https://internal.example.com/hook",
        # Basta um dos IPs ser interno para recusar
        "https://rebind.example.com/hook",
    ],
)
def test_private_destinations_are_refused(url):
    with pytest.raises(WebhookUrlError) as error:
        validate_webhook_url(url, resolver=fake_resolver, allow_private=False)
    assert "rede interna" in str(error.value)


@pytest.mark.parametrize(
    "url, message",
    [
        ("ftp://hooks.example.com/x", "http://"),
        ("file:///etc/passwd", "http://"),
        ("javascript:alert(1)", "http://"),
        ("hooks.example.com/x", "http://"),
        ("https:///sem-host", "sem host"),
        ("https://user:senha@hooks.example.com/x", "usuario"),
        ("https://hooks.example.com:99999/x", "invalido"),
        ("http://hooks.example.com/x", "https"),
        ("https://hooks.example.com/" + "a" * 2100, "longo"),
    ],
)
def test_malformed_or_unsafe_urls_are_refused(url, message):
    with pytest.raises(WebhookUrlError) as error:
        validate_webhook_url(url, resolver=fake_resolver, allow_private=False)
    assert message in str(error.value)


def test_public_https_url_is_accepted():
    validate_webhook_url("https://hooks.example.com/x?a=1", resolver=fake_resolver, allow_private=False)


def test_host_that_does_not_resolve_is_refused():
    with pytest.raises(WebhookUrlError):
        validate_webhook_url("https://x.example.com/", resolver=lambda host: [], allow_private=False)


def test_allow_private_accepts_http_and_internal_hosts():
    validate_webhook_url("http://192.168.0.10:8123/api/webhook/abc", resolver=fake_resolver, allow_private=True)
    validate_webhook_url("http://localhost:8123/x", resolver=fake_resolver, allow_private=True)


def test_allow_private_still_refuses_other_schemes_and_credentials():
    for url in ("ftp://192.168.0.10/x", "http://user:senha@192.168.0.10/x"):
        with pytest.raises(WebhookUrlError):
            validate_webhook_url(url, resolver=fake_resolver, allow_private=True)


def test_setting_is_used_when_the_argument_is_omitted(monkeypatch):
    from app.core import webhook_url

    monkeypatch.setattr(webhook_url.settings, "webhook_allow_private", True)
    validate_webhook_url("http://localhost/x")
    monkeypatch.setattr(webhook_url.settings, "webhook_allow_private", False)
    with pytest.raises(WebhookUrlError):
        validate_webhook_url("http://localhost/x")
