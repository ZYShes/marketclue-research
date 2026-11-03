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
  if (MOCK) {
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
  if (err.status === 401) return "Your session has ended. Please sign in again.";
  return err.message;
}
