"""A fake eBay API (token endpoint and Browse search) behind a monkeypatched requests.request."""

import json
from types import SimpleNamespace

import pytest

from app.capabilities import ebay


def listing(n, price, shipping=None, title=None, currency="USD"):
    return {
        "itemId": f"v1|{100000 + n}|0",
        "title": title or f"Handmade stoneware mug no. {n}, 12 oz",
        "price": {"value": f"{price:.2f}", "currency": currency},
        "itemWebUrl": f"https://www.ebay.com/itm/{100000 + n}?hash=item{n}:g:abc&amdata=enc%3A1",
        "condition": "New",
        "conditionId": "1000",
        "shippingOptions": ([{"shippingCostType": "FIXED", "shippingCost": {"value": f"{shipping:.2f}", "currency": "USD"}}]
                            if shipping is not None else []),
        "seller": {"username": f"seller{n}", "feedbackScore": 100 * n, "feedbackPercentage": "99.5"},
        "image": {"imageUrl": f"https://i.ebayimg.com/images/g/{n}/s-l500.jpg"},
        "buyingOptions": ["FIXED_PRICE"],
    }


ITEMS = [listing(1, 38.0, 6.5), listing(2, 24.5, 0), listing(3, 52.0), listing(4, 31.0, 8.25)]


def response(status, data=None):
    text = json.dumps(data) if data is not None else ""
    return SimpleNamespace(status_code=status, text=text, json=lambda: json.loads(text))


class FakeEbay:
    def __init__(self, items=None):
        self.items = list(ITEMS if items is None else items)
        self.calls = []
        self.failures = []

    def __call__(self, method, url, timeout=None, **kwargs):
        self.calls.append({"method": method, "url": url, "timeout": timeout, **kwargs})
        if self.failures:
            failure = self.failures.pop(0)
            if isinstance(failure, Exception):
                raise failure
            return response(failure, {"errors": [{"message": "failure"}]})
        if url == ebay.TOKEN_URL:
            return response(200, {"access_token": f"token-{len(self.token_calls)}", "expires_in": 7200,
                                  "token_type": "Application Access Token"})
        return response(200, {"href": url, "total": len(self.items), "limit": 20, "itemSummaries": self.items})

    @property
    def token_calls(self):
        return [call for call in self.calls if call["url"] == ebay.TOKEN_URL]

    @property
    def search_calls(self):
        return [call for call in self.calls if call["url"] == ebay.SEARCH_URL]


@pytest.fixture
def ebay_keys(aws):
    for name, value in {"ebay_client_id": "test-ebay-client", "ebay_client_secret": "test-ebay-secret"}.items():
        aws["ssm"].put_parameter(Name=f"/marketclue/{name}", Value=value, Type="SecureString")


@pytest.fixture
def fake_ebay(monkeypatch):
    fake = FakeEbay()
    monkeypatch.setattr(ebay.requests, "request", fake)
    ebay._token.update(value=None, expires=0.0)
    yield fake
    ebay._token.update(value=None, expires=0.0)
