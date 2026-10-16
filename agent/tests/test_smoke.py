"""Smoke tests for config loading and the webapp HTTP client.

These tests use httpx.MockTransport, so they need no running webapp or network.
Run with: uv run pytest -q
"""

import httpx

from agent_core.config import get_settings
from agent_core.runtime.webapp_client import WebappClient


def test_settings_loads() -> None:
    settings = get_settings()
    assert settings.webapp_base_url.startswith("http")


def test_base_url_trailing_slash_stripped_and_gateway_headers_set() -> None:
    client = WebappClient("http://localhost:3000/", token="t", user_id="u")
    assert client.base_url == "http://localhost:3000"
    assert client._client.headers["x-agent-token"] == "t"
    assert client._client.headers["x-agent-user-id"] == "u"
    client.close()


def test_client_without_token_sends_no_gateway_headers() -> None:
    client = WebappClient("http://localhost:3000")
    assert "x-agent-token" not in client._client.headers
    assert "x-agent-user-id" not in client._client.headers
    client.close()


def test_get_quote_parses_first_item() -> None:
    payload = {
        "items": [
            {
                "symbol": "AAPL",
                "companyName": "Apple Inc.",
                "price": "229.87",
                "change": "2.79",
                "changePercent": "1.23",
                "currency": "USD",
                "market": "US",
            }
        ]
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/quote/batch"
        assert request.url.params["symbols"] == "AAPL"
        return httpx.Response(200, json=payload)

    client = WebappClient("http://test", transport=httpx.MockTransport(handler))
    quote = client.get_quote("AAPL")
    client.close()

    assert quote["symbol"] == "AAPL"
    assert quote["price"] == "229.87"
    assert quote["changePercent"] == "1.23"


def test_get_quote_empty_when_symbol_unresolved() -> None:
    client = WebappClient(
        "http://test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, json={"items": []})
        ),
    )
    assert client.get_quote("ZZZZZ") == {}
    client.close()


def test_get_holdings_uses_gateway_path_and_sends_token() -> None:
    payload = {"items": [{"ticker": "AAPL", "quantity": 10}]}
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["token"] = request.headers.get("x-agent-token")
        seen["user"] = request.headers.get("x-agent-user-id")
        return httpx.Response(200, json=payload)

    client = WebappClient(
        "http://test",
        token="secret",
        user_id="owner-1",
        transport=httpx.MockTransport(handler),
    )
    holdings = client.get_holdings()
    client.close()

    assert seen["path"] == "/openapi/agent-gateway/holdings"
    assert seen["token"] == "secret"
    assert seen["user"] == "owner-1"
    assert len(holdings) == 1
    assert holdings[0]["ticker"] == "AAPL"
