# Task: Projects (v5)

Branch `projects` from `main` of ObserverLabs/marketclue-platform (a943148 or later). Read first:
`platform/SPEC.md` (v3 decisions, Teams, v4 templates), `platform/backend/README.md`, `platform/README.md`,
`platform/design/UX-RESEARCH.md`. Main has changes made after your last branch: templates (eBay seller),
`GET /api/ebay/account-deletion`, capped mock-ups, balanced mode. Owner: Yuexizi Zhang (credit her as
author everywhere). Commit as ObserverClaude, push only to `projects`, do not deploy; the main session
merges, deploys and runs live QA.

## Goal (owner, 2026-11-04)

- Every conversation and research run can belong to a **project**. A project is one business idea or
  product, e.g. "Handmade ceramic planters".
- A project holds many runs across the journey **Discover → Compare → Prepare → Grow**, several per stage
  if the founder repeats one.
- A project is personal or belongs to **one team**; a team has **many projects**; a person can be in
  **several teams** (today's one-team rule goes away).
- It must stay simple: easy to manage, easy to read, easy to **continue new research on an existing
  project**, and the AI **reads the project's reports and fact cards** when it researches.

## What others do (checked 2026-11-04) and what we take

| Product | Pattern | We take |
| --- | --- | --- |
| ChatGPT Projects | Chats + files + instructions in one project; shared projects get project-only memory; owners invite by email or link with chat or edit access ([help](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)) | Project-scoped context that the AI reads; nothing leaks across projects |
| Perplexity Projects (formerly Spaces) | Threads + files + instructions; viewer / collaborator roles; members don't see each other's memory ([help](https://www.perplexity.ai/help-center/en/articles/10352961-what-are-projects)) | Collaborators can start research inside a team project; private chats stay private |
| Claude Projects | Project knowledge + instructions; chats private by default even in shared projects ([help](https://support.claude.com/en/articles/9517075-what-are-projects)) | Same privacy split we already use: share finished output, not conversations |
| NotebookLM / Gemini Notebook | The notebook is the unit of work; notebooks don't share information; chat stays private in a shared notebook | One project = one unit; its fact cards are its knowledge base |

Not taken (too much for founders now): folders or nested projects, file uploads, a free-text
instructions editor, per-project roles beyond the team's owner/member.

## Data model

- `PROJECT#<id>` META: `project_id, name (≤80), owner_sub, team_id|null, brief {business, customer,
  location, stage, budget_usd} (all optional), default_template, created_at, updated_at, archived`.
- Index rows so lists are one query: `USER#<sub> / PROJECT#<id>` for personal projects and
  `TEAM#<team_id> / PROJECT#<id>` for team projects.
- `project_id` on conversations, runs (META and the user's run index row) and results (`result.project`).
- **Multiple teams:** replace `team_id` on the profile with membership rows `USER#<sub> / TEAMMEMBER#<team_id>`
  (role). Keep `TEAM#<id> / MEMBER#<sub>`. Limits: at most 10 teams per person, 50 projects per person.
- Migration (one script under `infra/`, idempotent, dry-run flag): profile `team_id` → membership row;
  for each existing team create a project named after the team and file the members' done runs into it,
  so nothing a teammate could see before disappears; all other runs and conversations stay unfiled.

## Visibility rules (same spirit as v3)

- A personal project: only its owner.
- A team project: every current member of that team sees the project, its **done** reports (read-only) and
  its fact cards, and may start new research in it. Conversations and runs that are not done stay private
  to whoever started them.
- Only the project owner or the team owner can rename, edit the brief, move or archive a project.
- Moving a project to another team (or back to personal) moves the visibility of all its reports with it.
- Team sharing becomes **per project**: unfiled runs are private. `GET /api/team/runs` / `team/cards` keep
  working but only return runs and cards from that team's projects.

## AI reads the project

When a conversation or run has a project:
- **Intake:** the research lead gets the project brief and a one-line list of the project's finished
  reports (stage, title, takeaway). It does not ask for what the brief already says, so continuing a
  project needs fewer questions. A ready brief writes new facts back into the project brief only for
  empty fields.
- **Planner and writer:** a compact project context (budget about 4,000 tokens): the brief, the latest done
  report's takeaway per stage, and up to 30 of the project's fact cards (claim, type, source title, date),
  newest and most-cited first.
- Earlier cards may be cited in the new report with their **original capture date** (they were quote-checked
  when made); the report labels them "from an earlier report in this project". New claims still need new
  checked cards. Planner avoids re-researching questions the project already answers and says so in the
  method line.
- Test that a run without a project behaves exactly as today.

## API

- `GET /api/projects` → `[{project_id, name, team: {team_id, name}|null, role, stages: {market_check: n, …},
  last_run_at, updated_at}]` (personal + all teams' projects, archived hidden unless `?archived=1`).
- `POST /api/projects {name, team_id?, brief?}`; `PATCH /api/projects/{id} {name?, brief?, team_id?|null,
  archived?}`; no hard delete in this task.
- `GET /api/projects/{id}` → project, `stages`: per feature the latest done run (title, takeaway, date,
  mode, template) and a count; `runs` (done runs visible to the viewer + the viewer's own unfinished ones),
  `conversations` (the viewer's own only).
- `GET /api/projects/{id}/cards?q=&type=` → the project's knowledge base (deduped).
- `POST /api/chat` new conversation accepts `project_id` (must be visible to the user; 404 otherwise).
  Runs inherit it. `PATCH /api/conversations/{id}` and `PATCH /api/runs/{id}` accept `{project_id|null}`
  (only the author; a project the author can see).
- Teams for several teams: `GET /api/teams` (my teams with role), and the existing team routes take
  `team_id` (`/api/teams/{id}`, `/invites`, `/members/{sub}`, `/leave`); keep `GET /api/team` working
  (first team) until the frontend is switched. Joining a second team no longer returns `already_in_team`.
- Error codes: `project_not_found` 404, `project_owner_only` 403, `project_limit` 429, `team_limit` 429.

## Frontend (keep it light)

- **Sidebar:** a "Projects" list above Recent (name + small team tag), "+ New project". Recent still shows
  everything, each row with its project name in muted text.
- **Project page** `#/p/<id>`: the name, team or "Personal", and one button **New research in this
  project**. Below, a **journey strip** of four stage cards (Discover, Compare, Prepare, Grow): each shows the
  latest report (title, date, one-line takeaway) or "Not started" with a Start link that opens New research
  with that tool and the project already chosen. Then two tabs: **Reports** (all, newest first, filter by
  stage) and **Fact cards** (the project's knowledge base, search box). A small "Project brief" box with
  Edit (five short fields). Nothing else.
- **New research:** a "Project" select at the top (default: the project you came from, else the last used,
  else "No project"; "+ New project" inline asks only for a name and Personal/Team). When a project has a
  brief, the first message box says "We already know: …" with the brief in one line.
- **Report and run pages:** a breadcrumb `Project › Compare` and "Move to project" in the report's menu
  (author only).
- **Team page:** a team picker when you are in several teams; the team's projects listed with links.
- Same accessibility bar as v3 (axe 0 violations, 44 px targets, keyboard), mock data in `mock.js`
  (two projects, one personal, one team, runs across stages), flows in `qa/projects/flows.js`.

## Tests

Backend: project CRUD and limits, visibility for owner / team member / outsider, moving between teams,
several teams per person, filing and moving conversations and runs, the migration script on a fake table,
project context in intake/planner/writer prompts (and no context without a project), earlier-card
citations, and every existing test still passing. Frontend: mock flows above.

## Done when

All tests and flows pass, SPEC gets a "v5: projects" section, README updated, branch pushed. Report what
you verified and anything the migration will change on the live table.
