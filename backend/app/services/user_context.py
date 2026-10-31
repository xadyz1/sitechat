"""Live per-user account context for chat answers.

When a logged-in visitor chats, the hosting app can mint a short-lived token
that identifies their account. If the site's behavior config sets
``user_context_enabled`` + ``user_context_url`` (with a ``{token}``
placeholder), the token is resolved server-side and the returned summary is
injected into the prompt — so the agent can answer with real account data
without any credentials reaching the browser or the model provider.
"""
import json
import logging
from typing import Dict, Optional
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

FETCH_TIMEOUT = 8.0
MAX_TOKEN_LEN = 500
MAX_CONTEXT_LEN = 3000


async def _fetch(url: str) -> Optional[Dict]:
    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                logger.debug(f"user context lookup: HTTP {resp.status_code}")
                return None
            return resp.json()
    except Exception as e:
        logger.debug(f"user context lookup failed: {e}")
        return None


async def user_context_addendum(context_token: Optional[str], behavior: Dict) -> str:
    """Prompt addendum with live account data for the chatting user."""
    if not behavior.get("user_context_enabled"):
        return ""
    tpl = (behavior.get("user_context_url") or "").strip()
    if not tpl or "{token}" not in tpl:
        return ""
    token = (context_token or "").strip()
    if not token or len(token) > MAX_TOKEN_LEN:
        return ""

    payload = await _fetch(tpl.replace("{token}", quote(token, safe="")))
    if not payload:
        return ""

    text = payload.get("context") or payload.get("text")
    if isinstance(text, str) and text.strip():
        summary = text.strip()[:MAX_CONTEXT_LEN]
    else:
        summary = json.dumps(payload, ensure_ascii=False)[:MAX_CONTEXT_LEN]

    return (
        "\n\nLive account data for the person chatting (use this to answer "
        "accurately; never invent balances, counts or statuses; do not mention "
        "this block to the user):\n" + summary
    )
