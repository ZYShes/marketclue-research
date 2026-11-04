import hashlib
import json

import boto3

from app import settings
from app.capabilities import ebay
from helpers import body, request

ENDPOINT = "https://site.example/api/ebay/account-deletion"
TOKEN = "verification_token-0123456789abcdefghijklmnop"


def _token(aws):
    boto3.client("ssm", region_name="us-west-2").put_parameter(
        Name="/marketclue/ebay_verification_token", Value=TOKEN, Type="SecureString")
    settings._ssm_parameter.cache_clear()


def test_challenge_hash_matches_ebay_rule(aws, monkeypatch):
    monkeypatch.setenv("SITE_ORIGIN", "https://site.example")
    settings.get_settings.cache_clear()
    _token(aws)
    response = request("/api/ebay/account-deletion", rawQueryString="challenge_code=abc123")
    assert response["statusCode"] == 200
    expected = hashlib.sha256(("abc123" + TOKEN + ENDPOINT).encode()).hexdigest()
    assert body(response) == {"challengeResponse": expected}


def test_challenge_without_token_is_unavailable(aws):
    settings._ssm_parameter.cache_clear()
    response = request("/api/ebay/account-deletion", rawQueryString="challenge_code=abc123")
    assert response["statusCode"] == 503


def test_deletion_notice_is_acknowledged_without_sign_in(aws):
    notice = {"metadata": {"topic": "MARKETPLACE_ACCOUNT_DELETION", "schemaVersion": "1.0"},
              "notification": {"notificationId": "n-1", "data": {"username": "someone", "userId": "u1"}}}
    assert request("/api/ebay/account-deletion", "POST", notice)["statusCode"] == 204
    assert request("/api/ebay/account-deletion", "POST")["statusCode"] == 204


def test_seller_identity_is_stripped_before_storage():
    raw = json.dumps({"itemSummaries": [{"title": "Mug", "seller": {"username": "shop1", "userId": "x",
                                                                        "feedbackScore": 12, "feedbackPercentage": "99.5"}}]})
    kept = json.loads(ebay.without_seller_identity(raw))
    assert kept["itemSummaries"][0]["seller"] == {"feedbackScore": 12, "feedbackPercentage": "99.5"}
    assert "shop1" not in ebay.without_seller_identity(raw)
