import copy

import pytest

from app import claude, intake, settings, store, templates
from ebay_fake import ebay_keys  # noqa: F401  (fixture)
from helpers import BRIEF, body, lambda_client, request, signed_in


GENERAL_BRIEF = {key: value for key, value in BRIEF.items() if key != "feature"}


def test_templates_require_a_session(aws):
    assert request("/api/templates")["statusCode"] == 401


def test_templates_list_shows_ebay_unavailable_until_connected(aws):
    session = signed_in()
    listed = body(request("/api/templates", session=session))
    assert listed == [
        {"id": "general", "name": "General", "description": templates.TEMPLATES["general"]["description"],
         "tools": ["market_check", "competitor_scan", "launch_checklist", "marketing_plan"], "capabilities": [],
         "available": True, "unavailable_reason": None},
        {"id": "ebay", "name": "eBay seller", "description": templates.TEMPLATES["ebay"]["description"],
         "tools": ["market_check", "competitor_scan", "launch_checklist", "marketing_plan"],
         "capabilities": [{"id": "ebay_listings", "label": "Searches live eBay listings"},
                          {"id": "ebay_fees", "label": "Estimates eBay fees and ad costs"}],
         "available": False, "unavailable_reason": "eBay is not connected yet"},
    ]


def test_templates_list_shows_ebay_available_with_keys(ebay_keys):
    ebay = body(request("/api/templates", session=signed_in()))[1]
    assert ebay["available"] is True and ebay["unavailable_reason"] is None


def fake_intake(monkeypatch, brief=None):
    calls = []

    def chat(conv, message):
        calls.append(copy.deepcopy(conv))
        return {"reply": "Press Start research.", "ready": True, "brief": copy.deepcopy(brief or GENERAL_BRIEF)}

    monkeypatch.setattr(intake, "chat", chat)
    return calls


def test_new_chat_defaults_to_general_and_keeps_the_brief_unchanged(aws, monkeypatch):
    session = signed_in()
    calls = fake_intake(monkeypatch)
    reply = body(request("/api/chat", "POST", {"message": "I make mugs", "feature": "competitor_scan"}, session))
    assert reply["template"] == "general" and reply["brief"] == GENERAL_BRIEF
    assert calls[0]["template"] == "general"
    conv = body(request(f"/api/conversations/{reply['conv_id']}", session=session))
    assert conv["template"] == "general" and "template" not in conv["brief"]
    assert body(request("/api/conversations", session=session))["conversations"][0]["template"] == "general"


def test_ebay_chat_is_refused_until_ebay_is_connected(aws, monkeypatch):
    session = signed_in()
    calls = fake_intake(monkeypatch)
    response = request("/api/chat", "POST", {"message": "I sell mugs", "template": "ebay"}, session)
    assert response["statusCode"] == 409
    assert body(response)["error"] == {"code": "template_unavailable", "message": "eBay is not connected yet"}
    assert calls == [] and store.count_conversations("founder") == 0


@pytest.mark.parametrize("template", ["shopify", "EBAY", 7, ["ebay"], {"id": "ebay"}])
def test_unknown_templates_are_rejected(aws, monkeypatch, template):
    fake_intake(monkeypatch)
    response = request("/api/chat", "POST", {"message": "Hi", "template": template}, signed_in())
    assert response["statusCode"] == 400 and body(response)["error"]["code"] == "invalid_template"


def test_ebay_template_flows_to_the_conversation_brief_run_and_lists(ebay_keys, monkeypatch):
    session = signed_in()
    calls = fake_intake(monkeypatch)
    reply = body(request("/api/chat", "POST", {"message": "I sell mugs", "feature": "competitor_scan", "template": "ebay"}, session))
    assert reply["template"] == "ebay" and reply["brief"]["template"] == "ebay"
    assert calls[0]["template"] == "ebay"
    resumed = body(request("/api/chat", "POST", {"conv_id": reply["conv_id"], "message": "More", "template": "general"}, session))
    assert resumed["template"] == "ebay" and calls[1]["template"] == "ebay"
    assert body(request(f"/api/conversations/{reply['conv_id']}", session=session))["template"] == "ebay"
    client = lambda_client(monkeypatch)
    run = body(request("/api/runs", "POST", {"conv_id": reply["conv_id"]}, session))["run"]
    assert run["template"] == "ebay" and run["brief"]["template"] == "ebay"
    assert store.get_run(run["run_id"])["template"] == "ebay"
    assert body(request("/api/runs", session=session))["runs"][0]["template"] == "ebay"
    client.invoke.assert_called_once()


def test_runs_are_refused_when_the_template_became_unavailable(ebay_keys, monkeypatch, aws):
    session = signed_in()
    fake_intake(monkeypatch)
    conv_id = body(request("/api/chat", "POST", {"message": "Mugs", "template": "ebay"}, session))["conv_id"]
    aws["ssm"].delete_parameter(Name="/marketclue/ebay_client_secret")
    settings._ssm_parameter.cache_clear()
    client = lambda_client(monkeypatch)
    response = request("/api/runs", "POST", {"conv_id": conv_id}, session)
    assert response["statusCode"] == 409 and body(response)["error"]["code"] == "template_unavailable"
    assert store.get_user("founder")["runs_started"] == 0
    client.invoke.assert_not_called()


def test_general_intake_prompt_and_schema_are_unchanged():
    general = templates.TEMPLATES["general"]
    spec = intake.FEATURES["competitor_scan"]
    assert intake.system_prompt(spec, general) == intake.SYSTEM.format(**spec)
    assert intake.reply_schema(general) is intake.REPLY_SCHEMA


def test_ebay_intake_adds_needs_within_three_questions_and_fills_brief_ebay(monkeypatch):
    seen = {}
    answers = {"category": "Mugs", "example_listing": None, "condition": "new", "target_price_usd": 45,
               "buyer_pays_shipping": True, "shipping_cost_usd": 8, "sells_on_ebay": False}

    def json_call(usage, *, system, prompt, schema, effort, messages, cache):
        seen.update(system=system, schema=schema, cache=cache)
        return {"reply": "Ready.", "ready": True, "brief": {**GENERAL_BRIEF, "ebay": answers}}

    monkeypatch.setattr(claude, "json_call", json_call)
    out = intake.chat({"feature": "marketing_plan", "template": "ebay", "messages": []}, "I sell mugs on eBay")
    assert out["brief"]["template"] == "ebay" and out["brief"]["ebay"] == answers
    assert seen["cache"] is True  # the intake conversation is cached turn to turn
    assert out["brief"]["feature"] == "marketing_plan"
    assert 'template "eBay seller"' in seen["system"] and "the price they want to ask" in seen["system"]
    assert "same limit of three questions in total" in seen["system"]
    brief_schema = seen["schema"]["properties"]["brief"]["anyOf"][0]
    assert "ebay" in brief_schema["required"] and brief_schema["properties"]["ebay"]["properties"]["target_price_usd"]
    assert "ebay" not in intake.BRIEF_SCHEMA["properties"]
    general = intake.chat({"feature": "marketing_plan", "messages": []}, "Hello")
    assert "template" not in general["brief"]
