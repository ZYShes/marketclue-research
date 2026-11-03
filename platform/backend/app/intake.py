"""The super agent's intake chat: understand the founder before any research runs."""

from . import claude

SYSTEM = """You are the research lead at MarketClue, a service for solo founders who run a business on
their own. Before research starts you make sure you understand the founder's business. Keep it short:
ask at most three questions in total across the conversation, and ask one or two at a time. Use plain,
friendly English; many founders are not native speakers.

You need: what they sell, who buys it, where they sell (a city or online), their stage (idea, first
sales, growing), a rough marketing budget if they have one, and what decision they want to make next.
If the founder already gave enough, do not ask more questions.

When you have enough, set ready to true, write a brief, and in the reply summarize the brief in two or
three sentences and tell them to press "Start research". The brief's questions are 2-4 concrete
research questions that public web pages can answer (competitors and their prices, what customers say,
channels similar sellers use, suppliers or costs). Never promise market sizes or predictions.

Until you are ready, brief is null and ready is false."""

BRIEF_SCHEMA = {
    "type": "object",
    "properties": {
        "business": {"type": "string"},
        "customer": {"type": "string"},
        "location": {"type": ["string", "null"]},
        "stage": {"type": "string"},
        "budget_usd": {"type": ["number", "null"]},
        "goal": {"type": "string"},
        "questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["business", "customer", "location", "stage", "budget_usd", "goal", "questions"],
    "additionalProperties": False,
}

REPLY_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "ready": {"type": "boolean"},
        "brief": {"anyOf": [BRIEF_SCHEMA, {"type": "null"}]},
    },
    "required": ["reply", "ready", "brief"],
    "additionalProperties": False,
}


def chat(conv, message):
    """Returns {"reply", "ready", "brief"} for the founder's new message."""
    messages = []
    for turn in conv.get("messages") or []:
        role = "assistant" if turn.get("role") == "assistant" else "user"
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] += "\n\n" + turn.get("text", "")
        else:
            messages.append({"role": role, "content": turn.get("text", "")})
    if messages and messages[-1]["role"] == "user":
        messages[-1]["content"] += "\n\n" + message
    else:
        messages.append({"role": "user", "content": message})
    if messages[0]["role"] != "user":
        messages.insert(0, {"role": "user", "content": "Hi."})

    out = claude.json_call(None, system=SYSTEM, prompt=None, schema=REPLY_SCHEMA, effort="low", messages=messages)
    brief = out.get("brief") if out.get("ready") else None
    if brief:
        brief["questions"] = [q for q in brief.get("questions", []) if q.strip()][:4]
    return {"reply": out["reply"], "ready": bool(out.get("ready") and brief), "brief": brief}
