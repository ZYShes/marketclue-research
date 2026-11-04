import base64
import copy
import json
from unittest.mock import Mock

from app import auth, router, store
from app.handler import lambda_handler


BRIEF = {
    "business": "Hand-thrown ceramic mugs",
    "customer": "Coffee lovers who buy gifts",
    "location": "Portland, Oregon",
    "stage": "selling at markets",
    "budget_usd": 200,
    "goal": "Price the mugs for an online shop",
    "questions": ["What do similar mugs sell for?"],
    "feature": "competitor_scan",
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
        event["cookies"] = [f"mc_session={session}"]
    event.update(extra)
    return lambda_handler(event, None)


def body(response):
    assert response["headers"]["content-type"].startswith("application/json")
    return json.loads(response["body"])


def image(response):
    assert response["isBase64Encoded"] is True
    return base64.b64decode(response["body"])


def signed_in(sub="founder", email="founder@example.com", name="Founder"):
    store.upsert_user(sub, email, name, "")
    return auth.create_session({"sub": sub, "email": email})


def ready_conversation(sub="founder", conv_id="conversation", brief=None):
    store.save_conversation(sub, {
        "conv_id": conv_id, "messages": [{"role": "user", "text": "I make mugs", "at": "2026-11-03T10:00:00Z"}],
        "brief": copy.deepcopy(brief or BRIEF), "ready": True, "feature": (brief or BRIEF).get("feature"),
    })
    return conv_id


def lambda_client(monkeypatch):
    client = Mock()
    client.invoke.return_value = {"StatusCode": 202}
    monkeypatch.setattr(router, "_lambda_client", lambda: client)
    return client


def done_run(sub="founder", title="Mug prices", result=None, conv_id="conversation"):
    run = store.create_run(sub, conv_id, title, copy.deepcopy(BRIEF))
    store.save_result(run["run_id"], result or {"version": 3, "title": title, "brief": BRIEF, "cards": []})
    store.update_run(run["run_id"], status="done", stage="done")
    return store.get_run(run["run_id"])
