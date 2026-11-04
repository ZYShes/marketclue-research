"""The research lead's intake chat: understand the founder before any research runs."""

from . import claude, templates

FEATURES = {
    "market_check": {
        "name": "Find your customers",
        "question": "Who buys, and what do they say?",
        "needs": "what they sell, who they think buys it, and where they sell (a city or online)",
        "research": "who buys this, what buyers praise, what they complain about, and where buyers talk",
    },
    "competitor_scan": {
        "name": "Check competitors & prices",
        "question": "Who sells this, and for how much?",
        "needs": "the exact product (type, size, material), where they sell, and any competitors they already know",
        "research": "direct competitors, their prices by product and size, shipping and fees, and how they describe themselves",
    },
    "marketing_plan": {
        "name": "Get your first customers",
        "question": "Which channels, and what will it cost?",
        "needs": "what they sell, who buys it, where they sell, their stage, and a rough marketing budget",
        "research": "channels similar sellers use and their fees, low-budget promotion that worked, what buyers respond to, and typical costs",
    },
    "launch_checklist": {
        "name": "Get ready to sell",
        "question": "What do I need before I sell?",
        "needs": "what they sell, the city and state they sell from, and how they sell (online, market, store)",
        "research": "business registration and licences for their city and state, sales tax and permits, the selling platform's rules, and product safety or labelling rules, from official pages",
    },
}

SYSTEM = """You are the research lead at MarketClue, a service for solo founders who run a business on
their own. The founder chose the tool "{name}", which answers: {question}

Before research starts you make sure you understand enough. For this tool you need {needs}.
Ask at most three questions in total across the conversation, one or two at a time, in plain,
friendly English; many founders are not native speakers. If the founder already gave enough, do not
ask more.

When you have enough, set ready to true, write the brief, and in the reply summarize it in two or
three sentences and tell them to press "Start research". The brief's questions are 2-4 concrete
research questions about {research} that public web pages can answer. Never promise market sizes or
predictions. Until you are ready, brief is null and ready is false."""

TEMPLATE_SYSTEM = """

The founder also chose the template "{name}". For it you also need to learn {needs}. These count toward
the same limit of three questions in total: combine them with the questions above, and do not ask what the
founder already told you. Fill what you learn into the brief's {field} fields and use null for anything
still unknown."""

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


def reply_schema(template):
    """The reply schema; a template's brief_fields extend the brief (general: exactly REPLY_SCHEMA)."""
    if not template["brief_fields"]:
        return REPLY_SCHEMA
    brief = {**BRIEF_SCHEMA, "properties": {**BRIEF_SCHEMA["properties"], **template["brief_fields"]}}
    brief["required"] = list(brief["properties"])
    return {**REPLY_SCHEMA, "properties": {**REPLY_SCHEMA["properties"], "brief": {"anyOf": [brief, {"type": "null"}]}}}


def system_prompt(spec, template):
    prompt = SYSTEM.format(**spec)
    if template["intake_needs"]:
        prompt += TEMPLATE_SYSTEM.format(name=template["name"], needs=template["intake_needs"],
                                         field=" and ".join(template["brief_fields"]) or "extra")
    return prompt


def chat(conv, message):
    """Returns {"reply", "ready", "brief"} for the founder's new message."""
    feature = conv.get("feature") or "marketing_plan"
    spec = FEATURES.get(feature, FEATURES["marketing_plan"])
    template = templates.get(conv.get("template")) or templates.TEMPLATES[templates.DEFAULT]
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

    out = claude.json_call(None, system=system_prompt(spec, template), prompt=None, schema=reply_schema(template),
                           effort="low", messages=messages)
    brief = out.get("brief") if out.get("ready") else None
    if brief:
        brief["questions"] = [q for q in brief.get("questions", []) if q.strip()][:4]
        brief["feature"] = feature
        if template["id"] != templates.DEFAULT:
            brief["template"] = template["id"]
    return {"reply": out["reply"], "ready": bool(out.get("ready") and brief), "brief": brief}
