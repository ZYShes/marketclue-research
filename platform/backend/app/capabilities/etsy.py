"""Etsy capability: Etsy fees and Offsite Ads costs, and comparable Etsy listings, from etsy.com pages only.

No Etsy API key is used. Fee rates count only when a sourced card from an etsy.com help or policy page fetched in
this run states them (app/etsy_report.py); comparable listing prices come from etsy.com listing pages the research
agents fetched, as asking prices on the day the page was fetched, never sold prices.
"""

import urllib.parse

from . import Capability, register
from .local import host_of


def is_etsy(url) -> bool:
    host = host_of(url)
    return host == "etsy.com" or host.endswith(".etsy.com")


def is_etsy_listing(url) -> bool:
    return is_etsy(url) and urllib.parse.urlsplit(url or "").path.startswith("/listing/")


def is_etsy_help(url) -> bool:
    """An etsy.com help or policy page (not a listing or a shop page)."""
    path = urllib.parse.urlsplit(url or "").path
    return is_etsy(url) and not path.startswith(("/listing/", "/shop/", "/search", "/market/"))


ETSY_FEES = register(Capability(id="etsy_fees", label="Estimates Etsy fees and ad costs"))
