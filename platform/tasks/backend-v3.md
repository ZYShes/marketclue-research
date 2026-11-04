# Task: backend v3 (branch `backend-v3`)

Implement the v3 backend in platform/backend/ exactly as platform/SPEC.md v3 describes (read the whole
spec; v3 and Teams sections at the end win): conversation history list + resume + run↔conversation
link; Quick/Smarter modes (per-run research model, directions, fetches, writer effort; Smarter
owner-only); `result.charts` built in code from structured writer fields (add the needed fields to the
writer schemas in app/pipeline.py: e.g. numeric price fields for competitor rows, a suggested price band,
budget projection inputs with method) plus coverage chart; mock-up endpoints using the OpenAI Images API
behind SSM `/marketclue/openai_api_key` (503 `mockups_disabled` when absent; use the official `openai`
Python SDK, add it to requirements.txt); Teams (create, invite links + optional SES email via env
`SES_FROM`, join with matching Google email, remove member, leave, team runs, team cards, team access to
done runs; conversations stay private). Keep every existing route and contract working.

Code style: match the existing modules (plain, small functions, sparse comments). Tests: extend
platform/backend/tests with pytest + moto for every new route and rule (run with
`python -m pytest platform/backend/tests -q` after `pip install -r platform/backend/requirements-dev.txt -r
platform/backend/requirements.txt`). No network in tests; never call Claude/OpenAI for real (no keys
exist here). Do not touch platform/frontend/ or infra secrets. Update platform/infra/template.yaml only
for new env vars (OPENAI_IMAGE_MODEL, SES_FROM) and IAM (ses:SendEmail on the configured identity, S3
for mockups) — keep it deployable. Commit with
`git -c user.name=ObserverClaude -c user.email=observerax+claude@gmail.com commit` early and often; push
your branch. Final message: what changed, test count, anything the frontend must know.
