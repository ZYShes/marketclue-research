"""Projects: who sees and manages a project, what its page shows, and the context the AI reads from it.

A project is personal (its owner only) or belongs to one team (every current member). Done runs filed in a
project are visible to everyone who sees the project; unfinished runs and all conversations stay private.
"""

from . import store

FEATURES = ("market_check", "competitor_scan", "launch_checklist", "marketing_plan")
STAGES = {"market_check": "Discover", "competitor_scan": "Compare", "launch_checklist": "Prepare", "marketing_plan": "Grow"}
MAX_PROJECTS = 50
MAX_TEAMS = 10
CONTEXT_CARDS = 30
CONTEXT_CHARS = 14_000  # about 4,000 tokens
EARLIER_LABEL = "from an earlier report in this project"


def memberships(sub) -> dict:
    """{team_id: role} of the person's teams."""
    return {row["team_id"]: row["role"] for row in store.list_memberships(sub)}


def role(sub, project, teams) -> str | None:
    """"owner", "team_owner" or "member" when the person can see the project, else None."""
    if not project:
        return None
    if project.get("team_id"):
        team_role = teams.get(project["team_id"])
        if team_role is None:
            return None
        return "owner" if project["owner_sub"] == sub else ("team_owner" if team_role == "owner" else "member")
    return "owner" if project["owner_sub"] == sub else None


def can_manage(project_role) -> bool:
    return project_role in {"owner", "team_owner"}


def _feature(row):
    return row.get("feature") if row.get("feature") in FEATURES else "marketing_plan"


def visible_runs(project_id, viewer_sub) -> list[dict]:
    """Done runs plus the viewer's own unfinished runs, newest first."""
    return [row for row in store.project_runs(project_id) if row.get("status") == "done" or row["user_sub"] == viewer_sub]


def summary(project, project_role, teams_by_id, viewer_sub) -> dict:
    """The row GET /api/projects returns for one project."""
    runs = visible_runs(project["project_id"], viewer_sub)
    stages = {feature: 0 for feature in FEATURES}
    for row in runs:
        if row.get("status") == "done":
            stages[_feature(row)] += 1
    team = teams_by_id.get(project.get("team_id")) if project.get("team_id") else None
    return {
        "project_id": project["project_id"], "name": project["name"],
        "team": {"team_id": team["team_id"], "name": team["name"]} if team else None,
        "role": project_role, "can_manage": can_manage(project_role), "archived": bool(project.get("archived")),
        "default_template": project.get("default_template") or "general", "stages": stages,
        "last_run_at": runs[0]["created_at"] if runs else None, "updated_at": project.get("updated_at"),
    }


def detail(project, project_role, viewer_sub, team=None) -> dict:
    """GET /api/projects/{id}: the project, per-stage latest done report, visible runs and own conversations."""
    runs = visible_runs(project["project_id"], viewer_sub)
    names = {sub: (store.get_user(sub) or {}).get("name") or "" for sub in {row["user_sub"] for row in runs}}
    stages = {feature: {"count": 0, "latest": None} for feature in FEATURES}
    for row in runs:
        if row.get("status") != "done":
            continue
        stage = stages[_feature(row)]
        stage["count"] += 1
        if stage["latest"] is None:
            stage["latest"] = {key: row.get(key) for key in ("run_id", "title", "takeaway", "created_at", "mode", "template")}
    conversations = [conv for conv in store.list_conversations(viewer_sub, limit=100)
                     if conv.get("project_id") == project["project_id"]]
    return {
        "project": {
            **{key: project.get(key) for key in ("project_id", "name", "owner_sub", "brief", "default_template",
                                                 "created_at", "updated_at")},
            "archived": bool(project.get("archived")),
            "team": {"team_id": team["team_id"], "name": team["name"]} if team else None,
            "role": project_role, "can_manage": can_manage(project_role),
        },
        "stages": stages,
        "runs": [{**{key: row.get(key) for key in ("run_id", "title", "status", "feature", "mode", "template",
                                                  "created_at", "takeaway", "user_sub")},
                  "owner_name": names[row["user_sub"]], "mine": row["user_sub"] == viewer_sub} for row in runs],
        "conversations": conversations,
    }


def _brief_line(brief):
    parts = [f"{field.replace('_', ' ')}: {brief[field]}" for field in store.PROJECT_BRIEF_FIELDS
             if (brief or {}).get(field) not in (None, "")]
    return "; ".join(parts) if parts else "nothing yet"


def _day(timestamp):
    return (timestamp or "")[:10]


def finished_reports(project_id, exclude_run_id=None) -> list[dict]:
    return [row for row in store.project_runs(project_id)
            if row.get("status") == "done" and row["run_id"] != exclude_run_id]


def intake_context(project) -> str:
    """For the research lead: the project brief and one line per finished report."""
    lines = [f"Project: {project['name']}", f"Project brief: {_brief_line(project.get('brief'))}"]
    reports = finished_reports(project["project_id"])[:20]
    if reports:
        lines.append("Finished reports in this project:")
        lines += [f"- {STAGES[_feature(row)]}, {_day(row['created_at'])}: {row.get('title') or 'Report'}"
                  f" — {(row.get('takeaway') or '').strip()[:200]}" for row in reports]
    return "\n".join(lines)


def research_context(project, exclude_run_id=None, viewer_sub=None) -> dict:
    """For the planner and writer: brief, latest done takeaway per stage and up to 30 project cards
    (sourced first, then most-cited, then newest), within about 4,000 tokens. Returns {text, cards}."""
    lines = [f"Project: {project['name']}", f"Project brief: {_brief_line(project.get('brief'))}"]
    latest = {}
    for row in finished_reports(project["project_id"], exclude_run_id):
        latest.setdefault(_feature(row), row)
    if latest:
        lines.append("Latest finished report per stage:")
        lines += [f"- {STAGES[feature]} ({_day(row['created_at'])}): {row.get('title') or 'Report'} — "
                  f"{(row.get('takeaway') or '').strip()[:300]}" for feature, row in
                  sorted(latest.items(), key=lambda item: FEATURES.index(item[0]))]
    newest_first = store.project_cards(project["project_id"], viewer_sub)
    cards = sorted(newest_first, key=lambda card: (card.get("type") != "sourced", -len(card.get("run_ids") or [])))[:CONTEXT_CARDS]
    text = "\n".join(lines)
    kept = []
    if cards:
        text += "\nFact cards already in this project (id | type | claim | source | date):"
        for card in cards:
            line = (f"\n- {card['card_id']} | {card['type']} | {' '.join(card['claim'].split())[:240]} | "
                    f"{' '.join((card.get('source_title') or '').split())[:80]} | {_day(card.get('captured_at'))}")
            if len(text) + len(line) > CONTEXT_CHARS:
                break
            text += line
            kept.append(card)
    return {"text": text, "cards": kept}


def earlier_card(card) -> dict:
    """An earlier project card as it appears in a new report: original date, labelled as earlier."""
    label = f"{EARLIER_LABEL}; {card['label']}" if card.get("label") else EARLIER_LABEL
    return {**{key: value for key, value in card.items() if key not in {"stale", "added_by", "added_by_sub"}},
            "earlier": True, "label": label}
