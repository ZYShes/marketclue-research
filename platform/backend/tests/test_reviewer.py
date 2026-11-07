"""The reviewer sees each quote with the page it came from."""
import json

from app import claude, pipeline


def test_reviewer_gets_source_title_and_url_with_each_quote(monkeypatch):
    calls = []

    def fake_json_call(usage, *, system, prompt, schema, **kwargs):
        calls.append({"system": system, "prompt": prompt})
        return {"unsupported": [{"id": "f1", "reason": "The quote does not say this."}]}

    monkeypatch.setattr(claude, "json_call", fake_json_call)
    cards = [
        {"card_id": "bbb", "type": "sourced", "quote": "In most cases, your flowers are delivered but arrive late.",
         "source_title": "BBB Scam Alert: Don't let phony florists ruin Mother's Day", "url": "https://www.bbb.org/article/x"},
        {"card_id": "blog", "type": "unverified", "quote": "Unchecked words.", "source_title": "Blog", "url": "https://blog.example"},
    ]
    doc = {
        "takeaway": {"text": "Late flowers worry buyers.", "kind": "assumption", "card_ids": [], "method": ""},
        "findings": [
            {"title": "Late delivery", "text": "A BBB warning says flowers often arrive late.", "kind": "sourced",
             "card_ids": ["bbb", "blog"], "method": ""},
            {"title": "Other", "text": "Buyers love tulips.", "kind": "sourced", "card_ids": ["bbb"], "method": ""},
            {"title": "No source", "text": "Unchecked.", "kind": "sourced", "card_ids": ["blog"], "method": ""},
        ],
    }
    assert pipeline.check(None, doc, cards) == 2
    review = json.loads(calls[0]["prompt"].split("\n\n", 1)[1])
    assert review[0] == {"id": "f0", "statement": "Late delivery: A BBB warning says flowers often arrive late.",
                         "evidence": [{"quote": cards[0]["quote"], "source": cards[0]["source_title"], "url": cards[0]["url"]}]}
    assert [item["id"] for item in review] == ["f0", "f1"]  # an item with no checked card is not sent
    assert "title and URL" in calls[0]["system"]
    assert doc["findings"][0]["kind"] == "sourced" and doc["findings"][0]["card_ids"] == ["bbb"]
    assert doc["findings"][1]["kind"] == "assumption" and doc["findings"][1]["card_ids"] == []
    assert doc["findings"][2]["kind"] == "assumption" and doc["findings"][2]["method"] == "Not backed by a checked quote."
