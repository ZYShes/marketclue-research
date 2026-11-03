import base64
import copy
import io
import json
import time
import urllib.request
from http.cookies import SimpleCookie
from unittest.mock import Mock

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app import auth, intake, router, store
from app.handler import lambda_handler


BRIEF = {
    "business": "A neighborhood bakery",
    "customer": "Local families",
    "location": "Seattle",
    "stage": "idea",
    "budget_usd": 1000,
    "goal": "Find the first customers",
    "questions": ["Which channels reach local families?"],
}


def request(path, method="GET", data=None, session=None, **extra):
    event = {
        "version": "2.0",
        "rawPath": path,
        "requestContext": {"http": {"method": method}},
        "headers": {},
        "rawQueryString": "",
        "isBase64Encoded": False,
    }
    if data is not None:
        event["body"] = json.dumps(data)
    if session:
        event["cookies"] = ["unrelated=value", f"mc_session={session}"]
    event.update(extra)
    return lambda_handler(event, None)


def body(response):
    assert response["headers"]["content-type"].startswith("application/json")
    return json.loads(response["body"])


def signed_in(sub="founder", email="founder@example.com"):
    store.upsert_user(sub, email, "Founder", "https://example.com/avatar.png")
    return auth.create_session({"sub": sub, "email": email})


def ready_conversation(sub="founder", conv_id="conversation"):
    store.save_conversation(
        sub,
        {
            "conv_id": conv_id,
            "messages": [],
            "brief": copy.deepcopy(BRIEF),
            "ready": True,
        },
    )
    return conv_id


@pytest.fixture(scope="session")
def rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def google_token(aws, monkeypatch, rsa_key):
    key = jwt.algorithms.RSAAlgorithm.to_jwk(rsa_key.public_key(), as_dict=True)
    key.update({"kid": "test-key", "alg": "RS256", "use": "sig"})
    jwks = json.dumps({"keys": [key]}).encode()
    fetch = Mock(side_effect=lambda *args, **kwargs: io.BytesIO(jwks))
    monkeypatch.setattr(urllib.request.OpenerDirector, "open", fetch)
    auth._jwks_client.cache_clear()

    def encode(**overrides):
        claims = {
            "sub": "google-founder",
            "email": "founder@example.com",
            "name": "Founder",
            "picture": "https://example.com/avatar.png",
            "aud": "test-google-client",
            "iss": "https://accounts.google.com",
            "exp": int(time.time()) + 3600,
            "email_verified": True,
        }
        for key_name, value in overrides.items():
            if value is None:
                claims.pop(key_name, None)
            else:
                claims[key_name] = value
        return jwt.encode(claims, rsa_key, algorithm="RS256", headers={"kid": "test-key"})

    encode.fetch = fetch
    yield encode
    auth._jwks_client.cache_clear()


def test_health_is_public_without_loading_session(aws, monkeypatch):
    monkeypatch.setattr(auth, "get_session", Mock(side_effect=AssertionError("Session not needed")))
    response = request("/api/health")
    assert response["statusCode"] == 200
    assert body(response) == {"ok": True}


@pytest.mark.parametrize(
    ("path", "method", "data"),
    [
        ("/api/me", "GET", None),
        ("/api/auth/logout", "POST", None),
        ("/api/chat", "POST", {"message": "Hello"}),
        ("/api/conversations/missing", "GET", None),
        ("/api/runs", "GET", None),
        ("/api/runs", "POST", {"conv_id": "missing"}),
        ("/api/runs/missing", "GET", None),
        ("/api/runs/missing/share", "POST", None),
        ("/api/cards", "GET", None),
    ],
)
def test_private_routes_require_session(aws, path, method, data):
    response = request(path, method, data)
    assert response["statusCode"] == 401
    assert set(body(response)["error"]) == {"code", "message"}


def test_google_login_verifies_rsa_and_sets_exact_session_claims(google_token):
    before = int(time.time())
    response = request("/api/auth/google", "POST", {"credential": google_token()})
    assert response["statusCode"] == 200
    user = body(response)["user"]
    assert user == {
        "sub": "google-founder",
        "email": "founder@example.com",
        "name": "Founder",
        "picture": "https://example.com/avatar.png",
        "is_owner": False,
        "free_runs_left": 1,
    }
    cookie = SimpleCookie()
    cookie.load(response["cookies"][0])
    session = cookie["mc_session"]
    assert session["httponly"] is True
    assert session["secure"] is True
    assert session["samesite"] == "Lax"
    assert session["path"] == "/"
    claims = jwt.decode(
        session.value,
        "test-session-secret-at-least-32-bytes",
        algorithms=["HS256"],
    )
    assert set(claims) == {"sub", "email", "exp"}
    assert claims["sub"] == "google-founder"
    assert claims["email"] == "founder@example.com"
    assert before + 7 * 86400 <= claims["exp"] <= int(time.time()) + 7 * 86400
    assert store.get_user("google-founder")["email"] == "founder@example.com"
    me = request("/api/me", session=session.value)
    assert me["statusCode"] == 200
    assert body(me) == {"user": user}


def test_google_jwks_are_cached_between_requests(google_token):
    token = google_token()
    first = request("/api/auth/google", "POST", {"credential": token})
    second = request("/api/auth/google", "POST", {"credential": token})
    assert first["statusCode"] == second["statusCode"] == 200
    assert google_token.fetch.call_count == 1
    fetched_request = google_token.fetch.call_args.args[0]
    assert fetched_request.full_url == "https://www.googleapis.com/oauth2/v3/certs"


@pytest.mark.parametrize("issuer", ["accounts.google.com", "https://accounts.google.com"])
def test_google_accepts_both_documented_issuers(google_token, issuer):
    response = request("/api/auth/google", "POST", {"credential": google_token(iss=issuer)})
    assert response["statusCode"] == 200


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "another-client"},
        {"aud": ["test-google-client"]},
        {"iss": "https://attacker.example"},
        {"exp": 1},
        {"email_verified": False},
        {"email_verified": "true"},
        {"email_verified": None},
        {"sub": None},
        {"sub": ""},
        {"email": None},
        {"email": ""},
        {"exp": None},
        {"aud": None},
        {"iss": None},
    ],
)
def test_google_rejects_invalid_claims(google_token, overrides):
    response = request("/api/auth/google", "POST", {"credential": google_token(**overrides)})
    assert response["statusCode"] == 401
    assert "error" in body(response)
    assert store.get_user("google-founder") is None


def test_google_rejects_wrong_signature(google_token):
    claims = jwt.decode(google_token(), options={"verify_signature": False})
    wrong_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(claims, wrong_key, algorithm="RS256", headers={"kid": "test-key"})
    response = request("/api/auth/google", "POST", {"credential": token})
    assert response["statusCode"] == 401


def test_google_rejects_hs256_algorithm(google_token):
    claims = jwt.decode(google_token(), options={"verify_signature": False})
    token = jwt.encode(claims, "attacker-secret-at-least-32-bytes-long", algorithm="HS256")
    response = request("/api/auth/google", "POST", {"credential": token})
    assert response["statusCode"] == 401


@pytest.mark.parametrize("credential", [None, "", 12, "not-a-token"])
def test_google_requires_valid_credential(aws, credential):
    response = request("/api/auth/google", "POST", {"credential": credential})
    assert response["statusCode"] in {400, 401}
    assert "error" in body(response)


def test_owner_login_has_unlimited_personal_runs(google_token):
    response = request("/api/auth/google", "POST", {"credential": google_token(email="owner@example.com")})
    user = body(response)["user"]
    assert user["is_owner"] is True
    assert user["free_runs_left"] is None


@pytest.mark.parametrize("header_name", ["cookie", "Cookie", "COOKIE"])
def test_session_in_cookie_header(aws, header_name):
    session = signed_in()
    response = request("/api/me", headers={header_name: f"other=1; mc_session={session}; more=2"})
    assert response["statusCode"] == 200
    assert body(response)["user"]["sub"] == "founder"


def test_function_url_cookie_list_can_include_multiple_cookie_pairs(aws):
    session = signed_in()
    response = request("/api/me", cookies=[f"other=1; mc_session={session}"])
    assert response["statusCode"] == 200


@pytest.mark.parametrize(
    "claims",
    [
        {"sub": "founder", "email": "founder@example.com", "exp": 1},
        {"sub": "founder", "email": "founder@example.com"},
        {"sub": "founder", "exp": 4102444800},
        {"email": "founder@example.com", "exp": 4102444800},
    ],
)
def test_invalid_session_claims_are_unauthorized(aws, claims):
    signed_in()
    token = jwt.encode(claims, "test-session-secret-at-least-32-bytes", algorithm="HS256")
    response = request("/api/me", session=token)
    assert response["statusCode"] == 401


def test_unknown_user_session_is_unauthorized(aws):
    token = auth.create_session({"sub": "missing-user", "email": "missing@example.com"})
    assert request("/api/me", session=token)["statusCode"] == 401


def test_tampered_session_is_unauthorized(aws):
    signed_in()
    token = jwt.encode(
        {"sub": "founder", "email": "founder@example.com", "exp": int(time.time()) + 600},
        "wrong-session-secret-at-least-32-bytes",
        algorithm="HS256",
    )
    assert request("/api/me", session=token)["statusCode"] == 401


def test_logout_clears_cookie_using_function_url_cookies(aws):
    response = request("/api/auth/logout", "POST", session=signed_in())
    assert response["statusCode"] == 200
    assert body(response) == {"ok": True}
    cookie = SimpleCookie()
    cookie.load(response["cookies"][0])
    cleared = cookie["mc_session"]
    assert cleared.value == ""
    assert cleared["max-age"] == "0"
    assert cleared["path"] == "/"
    assert cleared["httponly"] is True
    assert cleared["secure"] is True
    assert cleared["samesite"] == "Lax"


def test_chat_persists_patched_intake_and_can_resume(aws, monkeypatch):
    session = signed_in()
    calls = []

    def chat(conv, message):
        calls.append((copy.deepcopy(conv), message))
        return {"reply": "Who are your customers?", "ready": True, "brief": copy.deepcopy(BRIEF)}

    monkeypatch.setattr(intake, "chat", chat)
    response = request("/api/chat", "POST", {"message": "I am opening a bakery"}, session)
    assert response["statusCode"] == 200
    conversation = body(response)
    assert conversation["ready"] is True
    assert conversation["brief"] == BRIEF
    assert conversation["reply"] == "Who are your customers?"
    assert len(conversation["conv_id"]) == 12
    assert [(item["role"], item["text"]) for item in conversation["messages"]] == [
        ("user", "I am opening a bakery"),
        ("assistant", "Who are your customers?"),
    ]
    assert all(item["at"] for item in conversation["messages"])
    assert calls[0][1] == "I am opening a bakery"
    stored = store.get_conversation("founder", conversation["conv_id"])
    assert stored["messages"] == conversation["messages"]
    assert stored["brief"] == BRIEF
    loaded = request(f"/api/conversations/{conversation['conv_id']}", session=session)
    assert loaded["statusCode"] == 200
    assert body(loaded)["messages"] == conversation["messages"]
    resumed = request(
        "/api/chat", "POST", {"conv_id": conversation["conv_id"], "message": "Local families"}, session
    )
    assert resumed["statusCode"] == 200
    assert len(body(resumed)["messages"]) == 4
    assert store.get_user("founder")["runs_started"] == 0


def test_base64_encoded_json_body(aws, monkeypatch):
    session = signed_in()
    monkeypatch.setattr(intake, "chat", lambda conv, message: {"reply": "Hello", "ready": False, "brief": None})
    encoded = base64.b64encode(json.dumps({"message": "Café in Seattle"}).encode()).decode()
    response = request("/api/chat", "POST", session=session, body=encoded, isBase64Encoded=True)
    assert response["statusCode"] == 200
    assert body(response)["messages"][0]["text"] == "Café in Seattle"


@pytest.mark.parametrize("raw_body", ["not-json", "[]", "null", "42", "\"text\""])
def test_invalid_json_body_is_a_structured_error(aws, raw_body):
    response = request("/api/chat", "POST", session=signed_in(), body=raw_body)
    assert response["statusCode"] == 400
    assert set(body(response)["error"]) == {"code", "message"}


def test_invalid_base64_body_is_a_structured_error(aws):
    response = request("/api/chat", "POST", session=signed_in(), body="%%%", isBase64Encoded=True)
    assert response["statusCode"] == 400
    assert "error" in body(response)


@pytest.mark.parametrize("message", ["", "   ", None, 10, ["Hello"]])
def test_chat_rejects_invalid_message(aws, message):
    response = request("/api/chat", "POST", {"message": message}, signed_in())
    assert response["statusCode"] == 400


def test_private_conversations_cannot_be_read_or_resumed_by_other_users(aws, monkeypatch):
    ready_conversation()
    session = signed_in("other", "other@example.com")
    forbidden_intake = Mock(side_effect=AssertionError("Unauthorized intake call"))
    monkeypatch.setattr(intake, "chat", forbidden_intake)
    assert request("/api/conversations/conversation", session=session)["statusCode"] == 404
    assert request("/api/chat", "POST", {"conv_id": "conversation", "message": "Hello"}, session)["statusCode"] == 404
    forbidden_intake.assert_not_called()


def test_run_creation_reserves_quota_and_invokes_worker(aws, monkeypatch):
    session = signed_in()
    conv_id = ready_conversation()
    client = Mock()
    client.invoke.return_value = {"StatusCode": 202}
    monkeypatch.setattr(router, "_lambda_client", lambda: client)
    response = request("/api/runs", "POST", {"conv_id": conv_id}, session)
    assert response["statusCode"] == 201
    run = body(response)["run"]
    assert len(run["run_id"]) == 12
    assert run["status"] == "queued"
    assert run["brief"] == BRIEF
    assert store.get_run(run["run_id"])["conv_id"] == conv_id
    assert store.get_user("founder")["runs_started"] == 1
    client.invoke.assert_called_once()
    arguments = client.invoke.call_args.kwargs
    assert arguments["FunctionName"] == "marketclue-api"
    assert arguments["InvocationType"] == "Event"
    assert json.loads(arguments["Payload"]) == {"worker": "run", "run_id": run["run_id"]}
    me = body(request("/api/me", session=session))["user"]
    assert me["free_runs_left"] == 0
    listed = body(request("/api/runs", session=session))["runs"]
    assert [item["run_id"] for item in listed] == [run["run_id"]]
    loaded = body(request(f"/api/runs/{run['run_id']}", session=session))
    assert loaded["run"]["run_id"] == run["run_id"]
    assert loaded["result"] is None
    rejected = request("/api/runs", "POST", {"conv_id": conv_id}, session)
    assert rejected["statusCode"] == 402
    assert body(rejected)["error"]["code"] == "free_run_used"
    client.invoke.assert_called_once()


def test_run_requires_ready_conversation(aws, monkeypatch):
    session = signed_in()
    store.save_conversation("founder", {"conv_id": "not-ready", "messages": [], "brief": None, "ready": False})
    client = Mock()
    monkeypatch.setattr(router, "_lambda_client", lambda: client)
    response = request("/api/runs", "POST", {"conv_id": "not-ready"}, session)
    assert response["statusCode"] == 400
    assert store.get_user("founder")["runs_started"] == 0
    client.invoke.assert_not_called()


def test_run_invoke_failure_marks_failed_and_restores_quota(aws, monkeypatch):
    session = signed_in()
    conv_id = ready_conversation()
    client = Mock()
    client.invoke.side_effect = RuntimeError("Queue unavailable")
    monkeypatch.setattr(router, "_lambda_client", lambda: client)
    response = request("/api/runs", "POST", {"conv_id": conv_id}, session)
    assert response["statusCode"] == 502
    assert "error" in body(response)
    assert store.get_user("founder")["runs_started"] == 0
    runs = store.list_runs("founder")
    assert len(runs) == 1
    assert runs[0]["status"] == "failed"


def test_run_and_share_are_owner_only_but_shared_link_is_public(aws):
    founder_session = signed_in()
    run = store.create_run("founder", "conversation", "Bakery research", BRIEF)
    result = {"title": "Bakery research", "cards": [], "summary": ["A useful finding"]}
    store.save_result(run["run_id"], result)
    store.update_run(run["run_id"], status="done", stage="done")
    other_session = signed_in("other", "other@example.com")
    assert request(f"/api/runs/{run['run_id']}", session=other_session)["statusCode"] == 404
    assert request(f"/api/runs/{run['run_id']}/share", "POST", session=other_session)["statusCode"] == 404
    assert body(request("/api/runs", session=other_session))["runs"] == []
    shared = request(f"/api/runs/{run['run_id']}/share", "POST", session=founder_session)
    assert shared["statusCode"] == 200
    sharing = body(shared)
    assert sharing["token"]
    assert sharing["url"] == f"https://marketclue.example/#/shared/{sharing['token']}"
    public = request(f"/api/shared/{sharing['token']}")
    assert public["statusCode"] == 200
    data = body(public)
    assert data["run"]["run_id"] == run["run_id"]
    assert "user_sub" not in data["run"]
    assert data["result"] == result
    assert store.get_run(run["run_id"])["user_sub"] == "founder"
    assert request("/api/shared/unknown")["statusCode"] == 404
    assert request(f"/api/shared/{sharing['token']}", "POST")["statusCode"] == 401


def test_cards_filters_use_query_string_and_isolate_users(aws):
    session = signed_in()
    store.put_cards("founder", [{
        "claim": "A bakery charges $5", "quote": "$5 per loaf", "url": "https://example.com/bakery",
        "source_title": "Bakery prices", "captured_at": "2026-11-01T00:00:00Z", "type": "sourced",
        "direction": "Competitors & prices", "tags": ["price"],
    }], "research")
    store.put_cards("other", [{
        "claim": "Private", "quote": "Other founder's data", "url": "https://example.com/private",
        "source_title": "Private", "captured_at": "2026-11-01T00:00:00Z", "type": "sourced",
        "direction": "Competitors & prices", "tags": [],
    }], "private")
    response = request(
        "/api/cards", session=session,
        rawQueryString="q=BAKERY&type=sourced&direction=Competitors%20%26%20prices",
    )
    assert response["statusCode"] == 200
    cards = body(response)["cards"]
    assert len(cards) == 1
    assert cards[0]["claim"] == "A bakery charges $5"
    assert isinstance(cards[0]["stale"], bool)
    assert body(request("/api/cards", session=session, queryStringParameters={"q": "no-match"}))["cards"] == []


def test_unknown_authenticated_route_returns_json_404(aws):
    response = request("/api/missing", session=signed_in())
    assert response["statusCode"] == 404
    assert set(body(response)["error"]) == {"code", "message"}
