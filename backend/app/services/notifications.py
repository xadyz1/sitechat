"""
Push notification service (OneSignal).

Sends push notifications per site/channel when configured. The per-site
config lives at ``site.notifications`` (never inside ``site.config`` — that
document is served publicly to the widget). Account-level defaults can be
set via ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY env vars.
"""
from typing import Optional, Dict, Any

import aiohttp
from loguru import logger

from app.config import settings
from app.database import get_mongodb

ONESIGNAL_API_URL = "https://api.onesignal.com/notifications"

_EVENT_FLAG = {
    "new_message": "notify_new_message",
    "new_lead": "notify_new_lead",
    "handoff": "notify_handoff",
}


async def _get_notification_config(site_id: str) -> Optional[Dict[str, Any]]:
    """Resolved per-site notification config (site settings merged over env defaults)."""
    db = await get_mongodb()
    site = await db.get_site(site_id)
    if not site:
        return None

    conf = site.get("notifications") or {}
    return {
        "site_name": site.get("name") or site.get("domain") or site_id,
        "enabled": conf.get("enabled", False),
        "onesignal_app_id": conf.get("onesignal_app_id") or settings.ONESIGNAL_APP_ID,
        "onesignal_rest_api_key": conf.get("onesignal_rest_api_key") or settings.ONESIGNAL_REST_API_KEY,
        "notify_new_message": conf.get("notify_new_message", True),
        "notify_new_lead": conf.get("notify_new_lead", True),
        "notify_handoff": conf.get("notify_handoff", True),
    }


async def send_push(
    site_id: str,
    event: str,
    title: str,
    body: str,
    context: Optional[Dict[str, Any]] = None,
    url: Optional[str] = None,
) -> bool:
    """
    Send a OneSignal push notification for a site event.

    event: one of new_message | new_lead | handoff
    context: extra data payload (session_id, visitor info, snippet, ...)
    url: click-through URL (e.g. dashboard conversation link)
    """
    try:
        conf = await _get_notification_config(site_id)
        if not conf or not conf["enabled"]:
            return False

        flag = _EVENT_FLAG.get(event)
        if flag and not conf.get(flag, True):
            return False

        app_id = conf["onesignal_app_id"]
        api_key = conf["onesignal_rest_api_key"]
        if not app_id or not api_key:
            logger.debug(f"OneSignal not configured for site {site_id}; skipping {event}")
            return False

        payload: Dict[str, Any] = {
            "app_id": app_id,
            "target_channel": "push",
            # Scope delivery to subscriptions tagged with this site/channel
            "filters": [
                {"field": "tag", "key": "site_id", "relation": "=", "value": site_id}
            ],
            "headings": {"en": title},
            "contents": {"en": body},
            "data": {
                "site_id": site_id,
                "type": event,
                **(context or {}),
            },
        }
        if url:
            payload["url"] = url

        headers = {
            "Authorization": f"Key {api_key}",
            "Content-Type": "application/json",
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                ONESIGNAL_API_URL,
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status in (200, 201):
                    logger.info(f"OneSignal push sent for site {site_id} ({event})")
                    return True
                text = await resp.text()
                logger.warning(f"OneSignal push failed for site {site_id}: {resp.status} {text[:200]}")
                return False
    except Exception as e:
        logger.error(f"Push notification error for site {site_id}: {e}")
        return False


async def notify_new_message(site_id: str, session_id: str, snippet: str,
                             visitor_name: Optional[str] = None,
                             page_url: Optional[str] = None) -> bool:
    conf_name = (await _get_notification_config(site_id) or {}).get("site_name", site_id)
    who = visitor_name or "A visitor"
    return await send_push(
        site_id,
        "new_message",
        f"New message — {conf_name}",
        f"{who}: {snippet[:140]}",
        context={"session_id": session_id, "visitor_name": visitor_name, "page_url": page_url},
        url=f"{settings.SITE_URL}/app",
    )


async def notify_new_lead(site_id: str, session_id: str, email: Optional[str],
                          name: Optional[str], source: str) -> bool:
    conf_name = (await _get_notification_config(site_id) or {}).get("site_name", site_id)
    who = name or email or "Anonymous"
    return await send_push(
        site_id,
        "new_lead",
        f"New lead — {conf_name}",
        f"{who} ({source}) just left their contact details",
        context={"session_id": session_id, "email": email, "name": name, "source": source},
        url=f"{settings.SITE_URL}/app",
    )


async def notify_handoff(site_id: str, session_id: str, reason: Optional[str],
                         visitor_name: Optional[str] = None,
                         visitor_email: Optional[str] = None) -> bool:
    conf_name = (await _get_notification_config(site_id) or {}).get("site_name", site_id)
    who = visitor_name or visitor_email or "A visitor"
    return await send_push(
        site_id,
        "handoff",
        f"Live agent requested — {conf_name}",
        f"{who} wants to talk to a human ({reason or 'user request'})",
        context={"session_id": session_id, "reason": reason,
                 "visitor_name": visitor_name, "visitor_email": visitor_email},
        url=f"{settings.SITE_URL}/app",
    )
