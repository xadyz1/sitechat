"""
Notification settings routes (OneSignal).

Per-site/channel push notification config. Stored on the site document under
``notifications`` (top-level — never inside ``site.config``, which is served
publicly to the widget). The REST API key is write-only via the API and masked
on read.
"""
from fastapi import APIRouter, HTTPException, Depends
from loguru import logger

from app.database import get_mongodb
from app.models.schemas import SiteNotificationsConfig
from app.routes.auth import require_auth
from app.core.site_access import can_manage_site

router = APIRouter(prefix="/api/sites/{site_id}/notifications", tags=["notifications"])


def _masked(conf: dict) -> dict:
    """Return config with the REST API key masked."""
    out = dict(conf or {})
    key = out.get("onesignal_rest_api_key")
    out["onesignal_rest_api_key"] = ("••••" + key[-4:]) if key else None
    out["has_api_key"] = bool(key)
    return out


@router.get("")
async def get_notification_config(site_id: str, user: dict = Depends(require_auth)):
    db = await get_mongodb()
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")
    return _masked(site.get("notifications") or SiteNotificationsConfig().model_dump())


@router.put("")
async def update_notification_config(site_id: str, conf: SiteNotificationsConfig,
                                     user: dict = Depends(require_auth)):
    db = await get_mongodb()
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")

    data = conf.model_dump()
    # Empty key => keep the existing stored key (don't wipe it on save)
    existing_key = (site.get("notifications") or {}).get("onesignal_rest_api_key")
    if not data.get("onesignal_rest_api_key"):
        data["onesignal_rest_api_key"] = existing_key

    await db.update_site(site_id, {"notifications": data})
    logger.info(f"Notification config updated for site {site_id} (enabled={data['enabled']})")
    return _masked(data)
