"""Claude API calls for MarketClue, with per-run usage and cost accounting."""

import json
import os
import threading

import anthropic
import boto3

# The lead/planner model and the research-agent model can differ (env PLAN_MODEL / RESEARCH_MODEL).
PLAN_MODEL = os.environ.get("PLAN_MODEL", "claude-opus-5-5")
RESEARCH_MODEL = os.environ.get("RESEARCH_MODEL", "claude-opus-5-5")
FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Automatic prompt caching: the API puts the breakpoint on the last cacheable block and moves it forward as
# a conversation grows, so each request reads the prefix the previous one wrote (5-minute TTL). Prefixes under
# the model's minimum (512 tokens on the 5.5 models) are simply not cached.
CACHE = {"type": "ephemeral"}

# USD per million tokens: input, output, cache read, cache write. Web search is $10 per 1,000.
PRICES = {
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20, 2.50),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
}
PRICE_WEB_SEARCH = 0.01

# Dynamic-filtering web tools only for Opus. Sonnet with them ran searches inside code execution, used up
# its search budget after one round and read almost no pages (2026-11-04 test: 1 page, 1 finding vs 3 pages,
# 5 findings with the basic tools), so Sonnet and Haiku use the basic versions.
DYNAMIC_WEB_TOOLS = {"claude-opus-5-5"}
# Server-side refusal fallbacks are not available for Haiku.
NO_FALLBACKS = {"claude-haiku-5-5"}

_client = None
_client_lock = threading.Lock()


class RefusedError(RuntimeError):
    """Claude and its fallback model both declined the request."""


def _api_key():
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    prefix = os.environ.get("SSM_PREFIX", "/marketclue")
    ssm = boto3.client("ssm")
    return ssm.get_parameter(Name=f"{prefix}/anthropic_api_key", WithDecryption=True)["Parameter"]["Value"]


def client():
    global _client
    with _client_lock:
        if _client is None:
            _client = anthropic.Anthropic(api_key=_api_key(), max_retries=3, timeout=300)
        return _client


class Usage:
    """Thread-safe token and tool counters for one run."""

    def __init__(self):
        self._lock = threading.Lock()
        self.input_tokens = 0
        self.output_tokens = 0
        self.cache_read_tokens = 0
        self.cache_write_tokens = 0
        self.web_searches = 0
        self.web_fetches = 0
        self.token_cost = 0.0

    def add(self, response, model):
        u = response.usage
        tools = getattr(u, "server_tool_use", None)
        p_in, p_out, p_read, p_write = PRICES.get(model, PRICES["claude-opus-5-5"])
        tokens = (
            u.input_tokens or 0,
            u.output_tokens or 0,
            getattr(u, "cache_read_input_tokens", 0) or 0,
            getattr(u, "cache_creation_input_tokens", 0) or 0,
        )
        with self._lock:
            self.input_tokens += tokens[0]
            self.output_tokens += tokens[1]
            self.cache_read_tokens += tokens[2]
            self.cache_write_tokens += tokens[3]
            self.token_cost += (tokens[0] * p_in + tokens[1] * p_out + tokens[2] * p_read + tokens[3] * p_write) / 1e6
            if tools:
                self.web_searches += getattr(tools, "web_search_requests", 0) or 0
                self.web_fetches += getattr(tools, "web_fetch_requests", 0) or 0

    def cost_usd(self):
        return round(self.token_cost + self.web_searches * PRICE_WEB_SEARCH, 4)

    def as_dict(self):
        return {
            "usd": self.cost_usd(),
            "input_tokens": self.input_tokens + self.cache_read_tokens + self.cache_write_tokens,
            "output_tokens": self.output_tokens,
            "web_searches": self.web_searches,
            "web_fetches": self.web_fetches,
        }


def create(usage, model=None, **kwargs):
    """One Messages API call with refusal fallbacks; records usage and raises on a final refusal."""
    model = model or PLAN_MODEL
    if model not in NO_FALLBACKS:
        kwargs.update(betas=[FALLBACK_BETA], fallbacks="default")
    response = client().beta.messages.create(model=model, **kwargs)
    if usage is not None:
        usage.add(response, model)
    u = response.usage
    print(json.dumps({"claude_call": model, "served_by": getattr(response, "model", None), "stop": response.stop_reason,
                      "in": u.input_tokens, "out": u.output_tokens,
                      "cache_read": getattr(u, "cache_read_input_tokens", 0) or 0,
                      "cache_write": getattr(u, "cache_creation_input_tokens", 0) or 0}))
    if response.stop_reason == "refusal":
        details = response.stop_details
        category = getattr(details, "category", None) if details else None
        raise RefusedError(f"Claude declined this request (category: {category})")
    return response


def text_of(response):
    return "\n".join(block.text for block in response.content if block.type == "text").strip()


def json_call(usage, *, system, prompt, schema, effort="low", max_tokens=16000, messages=None, cache=False):
    """Structured output: returns the parsed JSON object that matches `schema`. cache=True turns on automatic
    prompt caching, for multi-turn calls whose next request repeats this one's messages."""
    response = create(
        usage,
        max_tokens=max_tokens,
        system=system,
        messages=messages or [{"role": "user", "content": prompt}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        **({"cache_control": CACHE} if cache else {}),
    )
    if response.stop_reason == "max_tokens":
        raise RuntimeError("The model ran out of room before finishing its answer")
    return json.loads(text_of(response))


def research_call(usage, *, system, prompt, model=None, max_searches=4, max_fetches=3, fetch_tokens=6000, effort="medium",
                  toolbox=None, max_turns=12):
    """Runs a web research turn and returns all content blocks. Paused server-tool turns are continued; with a
    toolbox, the agent's client tool calls are run and their results sent back until the agent ends its turn.
    Every request is cached: a continuation re-sends the fetched pages and tool results, which are then read
    from the cache instead of billed again in full. Messages are only appended, never edited, so the prefix
    stays byte-identical from turn to turn (and replayed thinking blocks stay valid)."""
    model = model or RESEARCH_MODEL
    dynamic = model in DYNAMIC_WEB_TOOLS
    tools = [
        {"type": "web_search_20260209" if dynamic else "web_search_20250305", "name": "web_search", "max_uses": max_searches},
        {"type": "web_fetch_20260209" if dynamic else "web_fetch_20250910", "name": "web_fetch",
         "max_uses": max_fetches, "max_content_tokens": fetch_tokens},
    ]
    if toolbox:
        tools += toolbox.tools
    messages = [{"role": "user", "content": prompt}]
    blocks = []
    for _ in range(max_turns if toolbox else 4):
        response = create(
            usage,
            model=model,
            max_tokens=16000,
            system=system,
            messages=messages,
            tools=tools,
            output_config={"effort": effort},
            cache_control=CACHE,
        )
        blocks.extend(response.content)
        calls = [block for block in response.content if block.type == "tool_use"] if toolbox else []
        if response.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": response.content})
        elif response.stop_reason == "tool_use" and calls:
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": [toolbox.result_block(block) for block in calls]})
        else:
            break
    return blocks


def fetched_pages(blocks):
    """Page text captured by web_fetch, keyed by URL."""
    pages = {}
    for block in blocks:
        if block.type != "web_fetch_tool_result":
            continue
        result = block.content
        if getattr(result, "type", None) != "web_fetch_result":
            continue
        document = result.content
        source = getattr(document, "source", None)
        if getattr(source, "type", None) != "text":
            continue
        pages[result.url] = {
            "url": result.url,
            "title": getattr(document, "title", None) or result.url,
            "text": source.data or "",
            "retrieved_at": getattr(result, "retrieved_at", None),
        }
    return pages


def search_hits(blocks):
    """URLs and titles returned by web_search, for the run's source list."""
    hits = []
    for block in blocks:
        if block.type != "web_search_tool_result" or not isinstance(block.content, list):
            continue
        for item in block.content:
            if getattr(item, "type", None) == "web_search_result":
                hits.append({"url": item.url, "title": item.title})
    return hits
