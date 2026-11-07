// HTTP client for /api/*. In mock mode every call is answered by mock.js instead.

const cfg = window.MC_CONFIG || {};

export const API_BASE = String(cfg.apiBase || "/api").replace(/\/+$/, "");

export const MOCK =
  cfg.mock === true || new URLSearchParams(location.search).get("mock") === "1";

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

let mockModule = null;
let unauthorizedHandler = null;

// Called for any 401 except on requests made with {quiet401: true}.
export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

function defaultMessage(status) {
  if (status === 401) return "Please sign in to continue.";
  if (status === 403) return "You do not have access to this.";
  if (status === 404) return "We could not find that.";
  if (status === 429) return "Too many requests right now. Please try again later.";
  if (status >= 500) return "Something went wrong on our side. Please try again in a moment.";
  return "Something went wrong. Please try again.";
}

export async function api(path, { method = "GET", body, query, quiet401 = false } = {}) {
  let url = path;
  if (query) {
    const pairs = Object.entries(query).filter(([, v]) => v != null && v !== "");
    const qs = new URLSearchParams(pairs).toString();
    if (qs) url += `?${qs}`;
  }

  let status;
  let data = null;
  // The boot script may already have asked for this (/me, the opening page's data) while the modules
  // were loading; use that answer once.
  const store = window.__mcEarly;
  const fresh = store && store.base === API_BASE && Date.now() - store.at < 15000; // used only for the opening page
  const early = !MOCK && method === "GET" && fresh && url.startsWith("/") && store[url];
  if (early) delete store[url];
  const pre = early ? await early : null;
  if (pre) {
    ({ status, data } = pre);
  } else if (MOCK) {
    mockModule = mockModule || (await import("./mock.js"));
    ({ status, data } = await mockModule.handle(method, url, body));
  } else {
    let res;
    try {
      res = await fetch(API_BASE + url, {
        method,
        credentials: "include",
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "network", "Could not reach MarketClue. Check your connection and try again.");
    }
    status = res.status;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (status >= 200 && status < 300) return data || {};

  const e = (data && data.error) || {};
  const err = new ApiError(status, e.code || `http_${status}`, e.message || defaultMessage(status));
  if (status === 401 && !quiet401 && unauthorizedHandler) unauthorizedHandler(err);
  throw err;
}

// Plain-English message for an error, with friendly wording for the quota cases.
export function friendlyError(err) {
  if (!(err instanceof ApiError)) return "Something went wrong. Please try again.";
  if (err.code === "free_run_used" || err.status === 402) {
    return "Your first report is free, and you have already used it. More runs are coming soon.";
  }
  if (err.code === "daily_limit") {
    return "MarketClue has reached today's limit for new reports. Please try again tomorrow.";
  }
  if (err.code === "smarter_daily_limit") {
    return "Smarter research has reached today's limit for the site. Choose a lighter depth, or try Smarter tomorrow.";
  }
  if (err.code === "smarter_owner_only") return "Smarter research is not available for your account yet. Choose a lighter depth.";
  if (err.code === "invalid_mode") return "This research depth is not available right now. Choose Quick.";
  if (err.code === "template_unavailable") {
    const reason = String(err.message || "").trim().replace(/\.$/, "");
    return `This template is not available right now${reason ? ` (${reason})` : ""}. Choose General to continue.`;
  }
  if (err.code === "invalid_template") return "This template cannot be used with the chosen tool. Choose General or another tool.";
  if (err.code === "mockups_disabled") return "Mock-ups are not available on this site.";
  if (err.code === "mockup_limit") return "This report already has the maximum of 3 mock-ups.";
  if (err.code === "invite_email_mismatch") {
    return "This invite was sent to a different email address. Sign in with the Google account the invite was sent to.";
  }
  if (err.code === "invite_expired") return "This invite has expired. Ask the team owner for a new link.";
  if (err.code === "invite_revoked") return "This invite was cancelled by the team owner.";
  if (err.code === "already_in_team") return "You are already in this team.";
  if (err.code === "project_not_found") return "That project was not found, or you no longer have access to it.";
  if (err.code === "project_owner_only") return "Only the project owner or the team owner can change this project.";
  if (err.code === "project_limit") {
    // 10 live (not archived) projects per owner: the server says whose limit; add how to free a slot.
    const said = String(err.message || "").trim() || "You have 10 live projects, the most one person can have.";
    return /archive/i.test(said) ? said : `${said.replace(/\.?$/, ".")} Archive a project you no longer use to free a slot.`;
  }
  if (err.code === "new_owner_required") return "Choose who takes over before you leave.";
  if (err.code === "conversation_limit") {
    return "You have 20 conversations that have not started a report. Open one you no longer need and delete it, then start again.";
  }
  if (err.code === "run_in_progress") return "This research is still running. You can delete the conversation when the report is ready.";
  if (err.code === "invalid_new_owner") return "Choose another member of this team to take over.";
  if (err.code === "owner_cannot_leave") return "You are the only member of this team, so you cannot leave it. Invite someone first.";
  if (err.code === "team_limit") return "You can be in at most 10 teams. Leave one before joining or creating another.";
  if (err.code === "no_team") return "You are not in that team.";
  if (err.status === 401) return "Your session has ended. Please sign in again.";
  return err.message;
}
