"""Capabilities of the local-business templates (Food truck, Restaurant / café, Daycare / childcare).

They need no API key and add no client tool: the research agents use web search and fetch, and the capability
decides what counts as evidence. Its rules live here and in app/local_report.py:

- official_requirements: a requirement is Sourced only when its card comes from an official page fetched in this
  run: a .gov site, a US locality domain (state.<st>.us, ci.<city>.<st>.us, co.<county>.<st>.us, ...) or one of the
  state- and city-run domains listed below.
- local_benchmarks: prices of nearby businesses from their own pages or listings, charted from sourced cards only.
- startup_costs: a startup cost range built from sourced cost cards and the founder's own figures.
"""

import re
import urllib.parse

from . import Capability, register

# Government sites that are not on .gov. Extend this list when a city's or state's official site uses another
# domain; check each one on the government's own .gov page first.
STATE_RUN_DOMAINS = (
    "myflorida.com",        # State of Florida portal
    "floridarevenue.com",   # Florida Department of Revenue
    "sunbiz.org",           # Florida Division of Corporations
    "lacity.org",           # City of Los Angeles
    "sfgov.org",            # City and County of San Francisco
    "sfdph.org",            # San Francisco Department of Public Health
    "denvergov.org",        # City and County of Denver
    "cityofchicago.org",    # City of Chicago
    "dallascityhall.com",   # City of Dallas
)
LOCALITY_US = re.compile(r"(^|\.)(state|ci|co|city|town|twp|vil|village|county)\.([a-z0-9-]+\.)?[a-z]{2}\.us$")


def host_of(url) -> str:
    host = urllib.parse.urlsplit((url or "").strip()).netloc.lower().split("@")[-1].split(":")[0]
    return host.rstrip(".")


def is_official(url) -> bool:
    """True for a government page: .gov, a US locality domain, or a listed state- or city-run domain."""
    host = host_of(url)
    if not host:
        return False
    if host == "gov" or host.endswith(".gov") or LOCALITY_US.search(host):
        return True
    return any(host == domain or host.endswith("." + domain) for domain in STATE_RUN_DOMAINS)


OFFICIAL_REQUIREMENTS = register(Capability(id="official_requirements", label="Checks permits from official pages"))
LOCAL_BENCHMARKS = register(Capability(id="local_benchmarks", label="Compares nearby businesses"))
STARTUP_COSTS = register(Capability(id="startup_costs", label="Estimates startup costs"))
