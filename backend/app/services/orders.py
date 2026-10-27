"""Live order-status lookup for chat answers.

When a visitor mentions an order reference (e.g. "SP-75115C"), fetch the
site's public tracking endpoint and inject the result into the prompt so
the agent can answer with real status, items and tracking info.
"""
import json
import logging
import re
from typing import Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# Order refs like SP-75115C, HP-0042 — the separator is required so plain
# uppercase/long words (ENCOMENDA, ESTADO) are never mistaken for refs.
DEFAULT_REF_PATTERN = r"\b[A-Z]{1,5}[-#][A-Z0-9]{3,}\b"
FETCH_TIMEOUT = 8.0
MAX_REFS = 2


def extract_order_refs(text: str, pattern: Optional[str] = None) -> List[str]:
    """Unique order references found in the message, first occurrences first."""
    try:
        rx = re.compile(pattern or DEFAULT_REF_PATTERN, re.IGNORECASE)
    except re.error:
        rx = re.compile(DEFAULT_REF_PATTERN, re.IGNORECASE)
    seen, out = set(), []
    for m in rx.finditer(text or ""):
        ref = m.group(0).upper().rstrip(".,;!?)")
        if ref not in seen:
            seen.add(ref)
            out.append(ref)
        if len(out) >= MAX_REFS:
            break
    return out


def _fmt_item(item: Dict) -> str:
    name = item.get("name") or item.get("title") or "?"
    qty = item.get("quantity") or item.get("qty") or 1
    return f"{name} x{qty}"


def format_order_context(ref: str, payload: Dict) -> str:
    """Compact, prompt-ready order summary from a tracking API payload."""
    if not isinstance(payload, dict):
        return f"Order {ref}: lookup returned no data."
    if payload.get("found") is False:
        return f"Order {ref}: not found."

    order = payload.get("order") if isinstance(payload.get("order"), dict) else payload
    lines = [f"Order {ref}:"]
    status = order.get("status") or payload.get("status")
    if status:
        lines.append(f"- status: {status}")
    for key, label in (("tracking_code", "tracking"), ("carrier", "carrier"),
                       ("total", "total"), ("currency", "currency"),
                       ("created_at", "created"), ("eta", "estimated delivery")):
        val = order.get(key)
        if val not in (None, ""):
            lines.append(f"- {label}: {val}")
    items = payload.get("items") or order.get("items") or []
    if items:
        lines.append("- items: " + ", ".join(_fmt_item(i) for i in items[:10] if isinstance(i, dict)))
    events = payload.get("events") or order.get("events") or []
    if events and isinstance(events[0], dict):
        ev = events[0]
        ev_status = ev.get("status") or ev.get("label") or ""
        ev_when = ev.get("date") or ev.get("created_at") or ev.get("timestamp") or ""
        if ev_status:
            lines.append(f"- latest event: {ev_status} {ev_when}".rstrip())
    if len(lines) == 1:
        # Unknown payload shape — pass a truncated JSON dump so the model can still read it.
        return f"Order {ref} data: {json.dumps(payload, ensure_ascii=False)[:1500]}"
    return "\n".join(lines)


async def fetch_order_status(url_template: str, ref: str) -> Optional[Dict]:
    """Fetch the tracking endpoint for one reference; None on any failure."""
    url = url_template.replace("{ref}", ref)
    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                logger.debug(f"order lookup {ref}: HTTP {resp.status_code}")
                return None
            return resp.json()
    except Exception as e:
        logger.debug(f"order lookup {ref} failed: {e}")
        return None


async def order_context_addendum(message: str, behavior: Dict) -> str:
    """Prompt addendum with live order data for refs mentioned in the message."""
    if not behavior.get("order_lookup_enabled"):
        return ""
    url_template = (behavior.get("order_lookup_url") or "").strip()
    if not url_template or "{ref}" not in url_template:
        return ""
    refs = extract_order_refs(message, behavior.get("order_ref_pattern"))
    if not refs:
        return ""
    parts = []
    for ref in refs:
        payload = await fetch_order_status(url_template, ref)
        parts.append(format_order_context(ref, payload) if payload else f"Order {ref}: lookup unavailable.")
    return ("\n\nLive order status (use this to answer the customer's question accurately; "
            "do not claim you cannot see orders):\n" + "\n".join(parts))
