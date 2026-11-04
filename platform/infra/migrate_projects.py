#!/usr/bin/env python3
"""Migrates the MarketClue table to v5 projects. Idempotent: a second run changes nothing. Author: Yuexizi Zhang.

For each team: a membership row USER#<sub>/TEAMMEMBER#<team_id> for every current member; one team project
named after the team, whose id is derived from the team id so a rerun finds it; and every done run of every
current member that has no project yet is filed into it, so nothing a teammate could see before disappears.
Other runs and all conversations stay unfiled. Stored result JSON is only read (to copy each filed run's
takeaway), never rewritten. PROFILE.team_id stays unless --drop-profile-team-id is given; drop it only after
the v5 code is live, because the v3 code still reads it.

Usage (from platform/):
  AWS_PROFILE=marketclue python3 infra/migrate_projects.py --table marketclue --bucket marketclue-data-<account> --dry-run
  AWS_PROFILE=marketclue python3 infra/migrate_projects.py --table marketclue --bucket marketclue-data-<account>
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

from boto3.dynamodb.conditions import Attr

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))


def _scan(table, **kwargs):
    while True:
        response = table.scan(**kwargs)
        yield from response.get("Items", [])
        if "LastEvaluatedKey" not in response:
            return
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def team_project_id(team_id):
    return "tp" + hashlib.sha1(f"team-project:{team_id}".encode()).hexdigest()[:10]


def migrate(dry_run=True, drop_profile_team_id=False, log=print):
    """Returns a report of what was (or, with dry_run, would be) changed."""
    from app import store

    table = store._table()
    report = {"teams": 0, "memberships_created": 0, "projects_created": 0, "runs_filed": 0, "takeaways_copied": 0,
              "profiles_with_team_id": 0, "profiles_mismatched": 0, "profile_team_ids_dropped": 0}
    teams = [store._public(item) for item in _scan(table, FilterExpression=Attr("PK").begins_with("TEAM#") & Attr("SK").eq("META"))]
    for team in sorted(teams, key=lambda t: t["created_at"]):
        report["teams"] += 1
        team_id, project_id = team["team_id"], team_project_id(team["team_id"])
        members = store.list_members(team_id)
        for member in members:
            if store._get(f"USER#{member['sub']}", f"TEAMMEMBER#{team_id}") is None:
                report["memberships_created"] += 1
                log(f"membership {member['sub']} -> team {team_id} ({member['role']})")
                if not dry_run:
                    table.put_item(Item=store.membership_item(team_id, member["sub"], member["role"], member["joined_at"]))
        if store.get_project(project_id) is None:
            report["projects_created"] += 1
            log(f"project {project_id} '{team['name']}' for team {team_id}")
            if not dry_run:
                store.create_project(team["owner_sub"], team["name"][:80], team_id=team_id, project_id=project_id)
        for member in members:
            for row in store.list_runs(member["sub"], limit=100_000):
                if row.get("status") != "done" or row.get("project_id"):
                    continue
                run = store.get_run(row["run_id"])
                if not run or run.get("project_id"):
                    continue
                report["runs_filed"] += 1
                log(f"file run {run['run_id']} ({member['sub']}) -> project {project_id}")
                if dry_run:
                    continue
                store.file_run(run["run_id"], project_id)
                if not run.get("takeaway"):
                    takeaway = ((store.load_result(run["run_id"]) or {}).get("takeaway") or {}).get("text")
                    if takeaway:
                        store.update_run(run["run_id"], takeaway=takeaway[:300])
                        report["takeaways_copied"] += 1
    profiles = _scan(table, FilterExpression=Attr("SK").eq("PROFILE") & Attr("team_id").exists())
    for profile in profiles:
        sub, team_id = profile["sub"], profile["team_id"]
        report["profiles_with_team_id"] += 1
        if store.get_member(team_id, sub) is None:
            report["profiles_mismatched"] += 1
            log(f"note: profile {sub} names team {team_id} but is not a member of it (left as it is)")
        if drop_profile_team_id:
            report["profile_team_ids_dropped"] += 1
            log(f"drop PROFILE.team_id of {sub}")
            if not dry_run:
                table.update_item(Key={"PK": f"USER#{sub}", "SK": "PROFILE"}, UpdateExpression="REMOVE team_id")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Migrate the MarketClue table to v5 projects (idempotent).")
    parser.add_argument("--table", required=True, help="DynamoDB table name, e.g. marketclue")
    parser.add_argument("--bucket", required=True, help="Data bucket (results are read for takeaways)")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-west-2"))
    parser.add_argument("--dry-run", action="store_true", help="Print what would change; write nothing")
    parser.add_argument("--drop-profile-team-id", action="store_true",
                        help="Also remove the legacy PROFILE.team_id (only after the v5 code is live)")
    args = parser.parse_args(argv)
    os.environ.update(TABLE_NAME=args.table, DATA_BUCKET=args.bucket, AWS_REGION=args.region)
    report = migrate(dry_run=args.dry_run, drop_profile_team_id=args.drop_profile_team_id)
    print(json.dumps({"dry_run": args.dry_run, **report}, indent=2))
    return report


if __name__ == "__main__":
    main()
