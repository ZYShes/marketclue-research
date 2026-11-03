"""End-to-end check against the deployed site: chat, run, poll, library, share.

Mints a session cookie for a test user with the session secret from SSM (no Google sign-in),
so it needs the deploy credentials. Usage:
  python infra/e2e_test.py https://<site>.cloudfront.net [--run]
Without --run it only checks health, auth and chat (cheap). With --run it starts one research
run, which spends Claude credits.
"""

import json
import sys
import time
import urllib.request

import boto3
import jwt

SITE = sys.argv[1].rstrip("/")
RUN = "--run" in sys.argv
TEST_SUB = "e2e-test-user"
TEST_EMAIL = "e2e-test@marketclue.invalid"


def ensure_test_user():
    table = boto3.Session(profile_name="marketclue", region_name="us-west-2").resource("dynamodb").Table("marketclue")
    table.update_item(
        Key={"PK": f"USER#{TEST_SUB}", "SK": "PROFILE"},
        UpdateExpression=("SET #sub = :sub, email = :email, #name = :name, picture = :picture, is_owner = :owner, "
                          "created_at = if_not_exists(created_at, :now), runs_started = if_not_exists(runs_started, :zero)"),
        ExpressionAttributeNames={"#sub": "sub", "#name": "name"},
        ExpressionAttributeValues={":sub": TEST_SUB, ":email": TEST_EMAIL, ":name": "E2E test", ":picture": "",
                                   ":owner": True, ":now": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), ":zero": 0},
    )


def session_cookie():
    ensure_test_user()
    ssm = boto3.Session(profile_name="marketclue", region_name="us-west-2").client("ssm")
    secret = ssm.get_parameter(Name="/marketclue/session_secret", WithDecryption=True)["Parameter"]["Value"]
    token = jwt.encode({"sub": TEST_SUB, "email": TEST_EMAIL, "exp": int(time.time()) + 3600}, secret, algorithm="HS256")
    return f"mc_session={token}"


COOKIE = session_cookie()


def call(method, path, body=None, cookie=True):
    req = urllib.request.Request(SITE + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", COOKIE)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def check(label, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if detail else ""))
    if not cond:
        sys.exit(1)


status, body = call("GET", "/api/health", cookie=False)
check("health", status == 200 and body.get("ok"), str(body))
status, body = call("GET", "/api/me", cookie=False)
check("me without cookie is 401", status == 401, str(status))
status, body = call("GET", "/api/me")
check("me with session", status == 200, json.dumps(body)[:200])

status, body = call("POST", "/api/chat", {"message": "I sell handmade ceramic planters at a Seattle farmers market and want to start selling online. Customers are plant lovers in their 20s and 30s. About 120 sold so far. Budget $300 for the first month. I want to know where to sell online and how to price."})
check("chat", status == 200 and body.get("reply"), json.dumps(body)[:300])
conv_id = body["conv_id"]
if not body.get("ready"):
    status, body = call("POST", "/api/chat", {"conv_id": conv_id, "message": "That's all the information I have. Please start."})
    check("chat follow-up", status == 200, json.dumps(body)[:300])
check("brief ready", body.get("ready") and body.get("brief"), json.dumps(body.get("brief"))[:300])

if not RUN:
    print("Chat checks passed; skipping the paid run (pass --run).")
    sys.exit(0)

status, body = call("POST", "/api/runs", {"conv_id": conv_id})
check("run created", status in (200, 201, 202) and body.get("run"), json.dumps(body)[:300])
run_id = body["run"]["run_id"]
t0 = time.time()
while True:
    status, body = call("GET", f"/api/runs/{run_id}")
    run = body.get("run") or {}
    print(f"  {int(time.time() - t0)}s stage={run.get('stage')} status={run.get('status')} cost={run.get('cost_usd')}")
    if run.get("status") in ("done", "failed") or time.time() - t0 > 900:
        break
    time.sleep(15)
check("run done", run.get("status") == "done", run.get("error") or "")
result = body.get("result") or {}
cards = result.get("cards") or []
check("result has sourced cards", any(c.get("type") == "sourced" for c in cards), f"{len(cards)} cards")
check("result has plan and budget", result.get("plan") and result.get("budget", {}).get("lines"))
status, body = call("GET", "/api/cards")
check("library lists cards", status == 200 and len(body.get("cards") or []) >= 1, f"{len(body.get('cards') or [])} cards")
status, body = call("POST", f"/api/runs/{run_id}/share")
check("share link", status == 200 and body.get("token"), json.dumps(body)[:200])
status, shared = call("GET", f"/api/shared/{body['token']}", cookie=False)
check("shared view is public", status == 200 and shared.get("result") and "user_sub" not in json.dumps(shared.get("run") or {}))
print(f"All checks passed. Run cost ${run.get('cost_usd')}, {int(time.time() - t0)} s.")
