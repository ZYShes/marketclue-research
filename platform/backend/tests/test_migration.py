import copy
import importlib.util
from pathlib import Path

import pytest

from app import store
from helpers import BRIEF, body, request, signed_in


def load_migration():
    path = Path(__file__).resolve().parents[2] / "infra" / "migrate_projects.py"
    spec = importlib.util.spec_from_file_location("migrate_projects", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def legacy_team(team_id, name, owner, members):
    """A v3 team: TEAM# META and MEMBER# rows plus PROFILE.team_id, and no membership rows or projects."""
    table = store._table()
    table.put_item(Item={"PK": f"TEAM#{team_id}", "SK": "META", "team_id": team_id, "name": name,
                         "owner_sub": owner, "created_at": f"2026-11-0{len(team_id)}T00:00:00Z"})
    for sub, role in [(owner, "owner")] + [(member, "member") for member in members]:
        table.put_item(Item={"PK": f"TEAM#{team_id}", "SK": f"MEMBER#{sub}", "sub": sub, "email": f"{sub}@example.com",
                             "name": sub.title(), "role": role, "joined_at": "2026-11-03T00:00:00Z"})
        table.update_item(Key={"PK": f"USER#{sub}", "SK": "PROFILE"}, UpdateExpression="SET team_id = :t",
                          ExpressionAttributeValues={":t": team_id})


def legacy_run(sub, title, status="done", takeaway="A useful takeaway."):
    run = store.create_run(sub, f"conv-{title}", title, copy.deepcopy(BRIEF))
    if status == "done":
        store.save_result(run["run_id"], {"version": 3, "title": title, "takeaway": {"text": takeaway}, "cards": []})
    store.update_run(run["run_id"], status=status)
    return run["run_id"]


@pytest.fixture
def legacy(aws):
    sessions = {sub: signed_in(sub, f"{sub}@example.com", sub.title()) for sub in ("lena", "max", "olga", "solo")}
    legacy_team("t1", "Clay Collective", "lena", ["max"])
    legacy_team("t22", "Leaf Studio", "olga", [])
    runs = {
        "lena_done": legacy_run("lena", "Lena report"),
        "max_done": legacy_run("max", "Max report", takeaway="Planters are listed at $40."),
        "max_running": legacy_run("max", "Max running", status="running"),
        "max_failed": legacy_run("max", "Max failed", status="failed"),
        "olga_done": legacy_run("olga", "Olga report"),
        "solo_done": legacy_run("solo", "Solo report"),
    }
    store.save_conversation("max", {"conv_id": "max-conv", "messages": [], "brief": None, "ready": False})
    store._table().update_item(Key={"PK": "USER#solo", "SK": "PROFILE"}, UpdateExpression="SET team_id = :t",
                               ExpressionAttributeValues={":t": "t1"})
    return sessions, runs


def snapshot():
    return sorted((item["PK"], item["SK"], repr(sorted(item.items()))) for item in store._table().scan()["Items"])


def test_dry_run_reports_and_writes_nothing(legacy):
    migration = load_migration()
    before = snapshot()
    lines = []
    report = migration.migrate(dry_run=True, log=lines.append)
    assert snapshot() == before
    assert report == {"teams": 2, "memberships_created": 3, "projects_created": 2, "runs_filed": 3, "takeaways_copied": 0,
                      "profiles_with_team_id": 4, "profiles_mismatched": 1, "profile_team_ids_dropped": 0}
    assert any("file run" in line for line in lines) and any("not a member" in line for line in lines)


def test_migration_files_done_team_runs_and_is_idempotent(legacy):
    sessions, runs = legacy
    migration = load_migration()
    report = migration.migrate(dry_run=False, log=lambda line: None)
    assert (report["memberships_created"], report["projects_created"], report["runs_filed"], report["takeaways_copied"]) == (3, 2, 3, 3)
    t1_project = migration.team_project_id("t1")
    project = store.get_project(t1_project)
    assert (project["name"], project["team_id"], project["owner_sub"]) == ("Clay Collective", "t1", "lena")
    filed = {row["run_id"]: row for row in store.project_runs(t1_project)}
    assert set(filed) == {runs["lena_done"], runs["max_done"]}
    assert filed[runs["max_done"]]["takeaway"] == "Planters are listed at $40."
    assert store.get_run(runs["max_running"])["project_id"] is None and store.get_run(runs["max_failed"])["project_id"] is None
    assert store.get_run(runs["solo_done"])["project_id"] is None
    assert store.get_conversation("max", "max-conv").get("project_id") is None
    assert [row["run_id"] for row in store.project_runs(migration.team_project_id("t22"))] == [runs["olga_done"]]
    assert [(m["team_id"], m["role"]) for m in store.list_memberships("max")] == [("t1", "member")]
    assert store.list_memberships("solo") == []
    assert store.get_user("max")["team_id"] == "t1"
    index = next(row for row in store.list_runs("max") if row["run_id"] == runs["max_done"])
    assert index["project_id"] == t1_project
    raw = store._s3().get_object(Bucket=store.get_settings().data_bucket, Key=f"runs/{runs['max_done']}.json")
    assert b'"project"' not in raw["Body"].read()

    max_view = body(request(f"/api/runs/{runs['lena_done']}", session=sessions["max"]))
    assert max_view["access"] == "project" and max_view["project"]["name"] == "Clay Collective"
    assert {r["run_id"] for r in body(request("/api/team/runs", session=sessions["lena"]))["runs"]} == {
        runs["lena_done"], runs["max_done"]}
    assert request(f"/api/runs/{runs['max_running']}", session=sessions["lena"])["statusCode"] == 404
    assert request(f"/api/runs/{runs['lena_done']}", session=sessions["olga"])["statusCode"] == 404
    assert request(f"/api/runs/{runs['lena_done']}", session=sessions["solo"])["statusCode"] == 404

    before = snapshot()
    again = migration.migrate(dry_run=False, log=lambda line: None)
    assert snapshot() == before
    assert (again["memberships_created"], again["projects_created"], again["runs_filed"]) == (0, 0, 0)


def test_profile_team_id_is_dropped_only_on_request(legacy):
    migration = load_migration()
    migration.migrate(dry_run=False, log=lambda line: None)
    report = migration.migrate(dry_run=False, drop_profile_team_id=True, log=lambda line: None)
    assert report["profile_team_ids_dropped"] == 4
    assert all("team_id" not in store.get_user(sub) for sub in ("lena", "max", "olga", "solo"))
    assert [m["team_id"] for m in store.list_memberships("lena")] == ["t1"]


def test_command_line_runs_a_dry_run(legacy, capsys):
    migration = load_migration()
    report = migration.main(["--table", "marketclue-test", "--bucket", "marketclue-test-data", "--dry-run"])
    assert report["runs_filed"] == 3 and '"dry_run": true' in capsys.readouterr().out
    assert store.list_memberships("max") == []
