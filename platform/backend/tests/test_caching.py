"""Prompt caching on multi-turn calls, and FINDING lines parsed without a model call."""

from types import SimpleNamespace

from app import claude, intake, pipeline
from test_ebay_pipeline import answer, fake_client, text


def test_json_call_caches_only_when_asked(monkeypatch, capsys):
    messages = fake_client(monkeypatch, [answer("end_turn", text('{"a": 1}')), answer("end_turn", text('{"a": 2}'))])
    schema = {"type": "object"}
    assert claude.json_call(None, system="S", prompt="P", schema=schema) == {"a": 1}
    assert claude.json_call(None, system="S", prompt="P", schema=schema, cache=True) == {"a": 2}
    plain, cached = messages.requests
    assert "cache_control" not in plain
    assert cached["cache_control"] == {"type": "ephemeral"}
    # The per-call log line reports cache reads and writes, so hits can be checked in the logs.
    assert '"cache_read": 0' in capsys.readouterr().out


def test_research_loop_caches_every_turn(monkeypatch):
    messages = fake_client(monkeypatch, [answer("pause_turn", text("1")), answer("pause_turn", text("2")),
                                         answer("end_turn", text("3"))])
    claude.research_call(None, system="S", prompt="P", model="claude-opus-5-5", effort="medium")
    assert len(messages.requests) == 3
    assert all(request["cache_control"] == {"type": "ephemeral"} for request in messages.requests)
    # Append-only: each request starts with every message of the one before, so it reads that request's cache.
    for before, after in zip(messages.requests, messages.requests[1:]):
        assert after["messages"][:len(before["messages"])] == before["messages"]
        assert (after["system"], after["tools"], after["output_config"]) == (before["system"], before["tools"], before["output_config"])


def reply(value):
    return answer("end_turn", text(f'{{"reply": "{value}", "ready": false, "brief": null}}'))


def test_intake_conversation_repeats_its_prefix_and_caches(monkeypatch):
    messages = fake_client(monkeypatch, [reply("Who buys them?"), reply("Where do you sell?")])
    conv = {"feature": "market_check", "template": None, "messages": []}
    first = intake.chat(conv, "Handmade mugs.")
    conv["messages"] += [{"role": "user", "text": "Handmade mugs."}, {"role": "assistant", "text": first["reply"]}]
    intake.chat(conv, "Coffee lovers in Seattle.")
    turn1, turn2 = messages.requests
    assert turn1["cache_control"] == turn2["cache_control"] == {"type": "ephemeral"}
    assert turn2["messages"][:len(turn1["messages"])] == turn1["messages"]
    assert turn2["messages"][len(turn1["messages"]):] == [
        {"role": "assistant", "content": "Who buys them?"}, {"role": "user", "content": "Coffee lovers in Seattle."}]
    # Nothing that varies per turn sits ahead of the conversation.
    assert turn1["system"] == turn2["system"] and turn1["output_config"] == turn2["output_config"]


def test_finding_lines_are_parsed_without_a_model_call():
    rows = [
        'FINDING | Large mugs cost $54 | "Our large mug costs $54." | https://shop.example/mugs',
        'FINDING | A buyer liked the glaze | "I said "wow" | the glaze is lovely" | https://forum.example/t/1?page=2',
        'FINDING | Curly quotes work too | “Ships in 3 days.” | https://shop.example/a_(b)',
    ]
    assert pipeline.parse_findings(rows) == [
        {"claim": "Large mugs cost $54", "quote": "Our large mug costs $54.", "url": "https://shop.example/mugs"},
        {"claim": "A buyer liked the glaze", "quote": 'I said "wow" | the glaze is lovely', "url": "https://forum.example/t/1?page=2"},
        {"claim": "Curly quotes work too", "quote": "Ships in 3 days.", "url": "https://shop.example/a_(b)"},
    ]


def test_a_line_off_format_falls_back_to_the_model(monkeypatch):
    rows = ["FINDING | Mugs cost $54 | Our large mug costs $54. | https://shop.example/mugs"]  # quote not in quotes
    assert pipeline.parse_findings(rows) is None
    calls = []
    page = SimpleNamespace(title="Shop", source=SimpleNamespace(type="text", data="Our large mug costs $54."))
    blocks = [SimpleNamespace(type="web_fetch_tool_result", content=SimpleNamespace(
                  type="web_fetch_result", url="https://shop.example/mugs", retrieved_at=None, content=page)),
              text(rows[0])]
    monkeypatch.setattr(claude, "research_call", lambda usage, **kwargs: blocks)

    def json_call(usage, **kwargs):
        calls.append(kwargs)
        return {"findings": [{"claim": "Mugs cost $54", "quote": "Our large mug costs $54.", "url": "https://shop.example/mugs"}]}
    monkeypatch.setattr(claude, "json_call", json_call)
    brief = {"business": "Mugs", "customer": "Coffee lovers", "stage": "Idea", "goal": "Sell", "questions": [],
             "feature": "competitor_scan"}
    findings, pages, _ = pipeline.research(None, brief, {"name": "Prices", "question": "What do mugs cost?"}, "smarter")
    assert len(calls) == 1 and "FINDING | Mugs cost $54" in calls[0]["prompt"]
    assert findings[0]["quote"] == "Our large mug costs $54." and "https://shop.example/mugs" in pages
