import copy
import json

from app import claude, intake, pipeline, projects, store, templates
from helpers import BRIEF, done_run
from test_modes import QUOTE, FakeClaude


EARLIER_QUOTE = "Glazed planters ship free on orders over $50."


def card(url, quote, run_id, sub="founder", type="sourced", captured="2026-10-20T00:00:00Z"):
    return store.put_cards(sub, [{"claim": f"Claim for {url}", "quote": quote, "url": url, "source_title": "Planter shop",
                                  "captured_at": captured, "type": type, "direction": "Prices", "tags": []}], run_id)[0]


class ProjectAwareClaude(FakeClaude):
    """Plans with `reused` when asked, and cites one earlier project card in the report."""

    def json_call(self, usage, *, system, prompt, schema, effort="low", **kwargs):
        props = schema["properties"]
        if "directions" in props and "reused" in props:
            self.json_calls.append({"prompt": prompt, "effort": effort, "schema": schema})
            return {"title": "Planters again", "reused": "Shipping terms come from the Compare report of Oct 20.",
                    "directions": [{"name": f"Direction {i}", "question": "Q?", "search_hints": ["h"]} for i in range(3)]}
        if "unsupported" in props:
            self.json_calls.append({"prompt": prompt, "effort": effort, "schema": schema})
            return {"unsupported": []}
        return super().json_call(usage, system=system, prompt=prompt, schema=schema, effort=effort, **kwargs)

    def report(self, prompt):
        doc = super().report(prompt)
        if "already in this project" in prompt:
            earlier_id = prompt.split("(id | type | claim | source | date):\n- ", 1)[1].split(" | ", 1)[0]
            doc["findings"][1] = {**doc["findings"][1], "card_ids": [earlier_id], "text": "Shipping is free over $50."}
        return doc


def project_with_history():
    store.upsert_user("founder", "founder@example.com", "Founder", "")
    project = store.create_project("founder", "Ceramic planters", brief={"business": "Ceramic planters", "budget_usd": 300})
    earlier = done_run("founder", "Planter prices", project_id=project["project_id"])
    store.update_run(earlier["run_id"], takeaway="Glazed planters are listed at $35 to $80.")
    old = card("https://planters.example/ship", EARLIER_QUOTE, earlier["run_id"])
    card("https://planters.example/rumour", "Maybe cheaper elsewhere", earlier["run_id"], type="unverified")
    return project, earlier, old


def run_pipeline(monkeypatch, fake, project_id=None):
    monkeypatch.setattr(claude, "research_call", fake.research_call)
    monkeypatch.setattr(claude, "json_call", fake.json_call)
    run = store.create_run("founder", "conversation", "Planters", copy.deepcopy(BRIEF), project_id=project_id)
    pipeline.run(run["run_id"])
    meta = store.get_run(run["run_id"])
    assert meta["status"] == "done", meta["error"]
    return meta, store.load_result(run["run_id"])


def test_planner_and_writer_read_the_project_and_cite_earlier_cards(aws, monkeypatch):
    project, earlier, old = project_with_history()
    fake = ProjectAwareClaude()
    meta, result = run_pipeline(monkeypatch, fake, project["project_id"])
    plan = fake.json_calls[0]
    assert "What this project already knows:" in plan["prompt"] and "Project brief: business: Ceramic planters; budget usd: 300" in plan["prompt"]
    assert "Compare (" in plan["prompt"] and "Glazed planters are listed at $35 to $80." in plan["prompt"]
    assert plan["schema"]["required"] == ["title", "directions", "reused"]
    writer = next(call for call in fake.json_calls if "takeaway" in call["schema"]["properties"])
    assert "from earlier reports in this project" in writer["prompt"] and old["card_id"] in writer["prompt"]
    assert writer["prompt"].index(old["card_id"]) < writer["prompt"].index("Every new claim still needs")
    review = next(call for call in fake.json_calls if "unsupported" in call["schema"]["properties"])
    assert EARLIER_QUOTE in review["prompt"]
    cited = next(c for c in result["cards"] if c["card_id"] == old["card_id"])
    assert cited["earlier"] is True and cited["label"] == "from an earlier report in this project"
    assert cited["captured_at"] == "2026-10-20T00:00:00Z" and "stale" not in cited
    assert result["findings"][1]["card_ids"] == [old["card_id"]] and result["findings"][1]["kind"] == "sourced"
    assert result["project"] == {"project_id": project["project_id"], "name": "Ceramic planters", "team_id": None,
                                 "reused": "Shipping terms come from the Compare report of Oct 20.", "earlier_cards": 1}
    assert sum(1 for c in result["cards"] if c.get("earlier")) == 1
    row = next(r for r in store.project_runs(project["project_id"]) if r["run_id"] == meta["run_id"])
    assert row["status"] == "done" and row["takeaway"].startswith("Large handmade mugs")


def test_a_run_without_a_project_sends_the_same_prompts_and_schemas(aws, monkeypatch):
    project_with_history()
    fake = ProjectAwareClaude()
    meta, result = run_pipeline(monkeypatch, fake)
    assert fake.json_calls[0]["schema"] is pipeline.DIRECTIONS_SCHEMA
    for call in fake.json_calls:
        assert "project" not in (call["prompt"] or "").lower()
    writer = next(call for call in fake.json_calls if "takeaway" in call["schema"]["properties"])
    assert writer["schema"] == pipeline.report_schema("competitor_scan")
    assert "project" not in result and not any(c.get("earlier") for c in result["cards"])
    assert QUOTE in json.dumps(result["cards"])


def test_intake_reads_the_project_and_nothing_without_one():
    spec, general = intake.FEATURES["marketing_plan"], templates.TEMPLATES["general"]
    context = "Project: Ceramic planters\nProject brief: business: Ceramic planters"
    with_project = intake.system_prompt(spec, general, context)
    assert with_project.startswith(intake.SYSTEM.format(**spec))
    assert context in with_project and "do not ask for it again" in with_project
    assert intake.system_prompt(spec, general, None) == intake.SYSTEM.format(**spec)


def test_intake_context_lists_finished_reports(aws):
    project, earlier, _ = project_with_history()
    store.create_run("founder", "c", "Still running", BRIEF, project_id=project["project_id"])
    text = projects.intake_context(store.get_project(project["project_id"]))
    assert text.splitlines() == [
        "Project: Ceramic planters", "Project brief: business: Ceramic planters; budget usd: 300",
        "Finished reports in this project:",
        f"- Compare, {earlier['created_at'][:10]}: Planter prices — Glazed planters are listed at $35 to $80."]


def test_research_context_keeps_30_cards_sourced_and_most_cited_first_within_the_budget(aws, monkeypatch):
    project, earlier, _ = project_with_history()
    second = done_run("founder", "More", project_id=project["project_id"])
    for n in range(40):
        made = card(f"https://many.example/{n}", f"Quote number {n} about planters", earlier["run_id"],
                    captured=f"2026-10-{n % 28 + 1:02d}T00:00:00Z")
        if n == 5:
            store.put_cards("founder", [{**made, "run_ids": None}], second["run_id"])
    context = projects.research_context(store.get_project(project["project_id"]), viewer_sub="founder")
    assert len(context["cards"]) == projects.CONTEXT_CARDS
    assert context["cards"][0]["url"] == "https://many.example/5"
    assert all(c["type"] == "sourced" for c in context["cards"])
    monkeypatch.setattr(projects, "CONTEXT_CHARS", 900)
    small = projects.research_context(store.get_project(project["project_id"]), viewer_sub="founder")
    assert len(small["text"]) <= 900 and 0 < len(small["cards"]) < projects.CONTEXT_CARDS
    assert all(c["card_id"] in small["text"] for c in small["cards"])
    excluded = projects.research_context(store.get_project(project["project_id"]), exclude_run_id=second["run_id"])
    assert "More" not in excluded["text"]
