"""Capabilities: tools a template's research agents may call besides web search and web fetch.

A capability is in-process code today: {id, label, tool_definitions, run(name, input, context), available()}.
A later one can be a remote MCP server reached through the Claude API MCP connector instead: it would carry
an MCP server entry rather than tool definitions and a run function, and research_call would pass it as
`mcp_servers`. That plumbing is not built yet.
"""

import json
import threading
from dataclasses import dataclass, field
from typing import Callable


@dataclass(frozen=True)
class Capability:
    id: str
    label: str
    tool_definitions: list = field(default_factory=list)
    run: Callable | None = None
    available: Callable[[], tuple[bool, str | None]] = lambda: (True, None)


REGISTRY: dict[str, Capability] = {}


def register(capability: Capability) -> Capability:
    REGISTRY[capability.id] = capability
    return capability


def get(capability_id: str) -> Capability:
    return REGISTRY[capability_id]


class RunContext:
    """State one run shares across its research agents: call counts and the evidence tool calls returned."""

    def __init__(self, run_id):
        self.run_id = run_id
        self.lock = threading.Lock()
        self.counts = {}
        self.evidence = {}
        self._key_locks = {}

    def key_lock(self, key) -> threading.Lock:
        """One lock per key, so agents asking the same thing at the same time wait for one answer."""
        with self.lock:
            return self._key_locks.setdefault(key, threading.Lock())

    def take(self, name, limit) -> bool:
        with self.lock:
            if self.counts.get(name, 0) >= limit:
                return False
            self.counts[name] = self.counts.get(name, 0) + 1
            return True

    def next_number(self, name) -> int:
        with self.lock:
            self.counts[name] = self.counts.get(name, 0) + 1
            return self.counts[name]

    def add_evidence(self, url, page):
        """Keeps the first evidence recorded for a URL; a listing found again by another agent is the same item."""
        with self.lock:
            self.evidence.setdefault(url, page)


class Toolbox:
    """The client tools of one run: definitions for Claude and run_tool() for the tool-use loop."""

    def __init__(self, capability_ids, run_id):
        self.context = RunContext(run_id)
        self.capabilities = [REGISTRY[cid] for cid in capability_ids if cid in REGISTRY and REGISTRY[cid].available()[0]]
        self.tools = [tool for capability in self.capabilities for tool in capability.tool_definitions]
        self._owners = {tool["name"]: capability for capability in self.capabilities for tool in capability.tool_definitions}

    def __bool__(self):
        return bool(self.tools)

    def run_tool(self, name, tool_input) -> dict:
        capability = self._owners.get(name)
        if capability is None or capability.run is None:
            return {"error": f"Unknown tool {name}"}
        try:
            return capability.run(name, tool_input if isinstance(tool_input, dict) else {}, self.context)
        except Exception as exc:
            print(json.dumps({"tool_failed": name, "error": f"{type(exc).__name__}: {str(exc)[:200]}"}))
            return {"error": "The tool failed; continue with web search."}

    def result_block(self, block) -> dict:
        """The tool_result content block answering one tool_use block."""
        result = self.run_tool(block.name, block.input)
        return {"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result, ensure_ascii=False),
                "is_error": "error" in result}


def available(capability_ids) -> tuple[bool, str | None]:
    for capability_id in capability_ids:
        ok, reason = REGISTRY[capability_id].available()
        if not ok:
            return False, reason
    return True, None


from . import ebay  # noqa: E402,F401  (registers the eBay capabilities)
