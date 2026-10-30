"""
Sites API routes for managing chatbot sites.
"""
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional
from loguru import logger

from app.database import get_mongodb
from app.database.vector_store import get_vector_store
from app.routes.auth import require_auth
from app.core.site_access import can_manage_site, can_view_site, is_admin, is_agent
from app.models.schemas import SiteConfig, SiteConfigUpdate, SiteQuickPromptsConfig, SiteNotificationsConfig

router = APIRouter(prefix="/api/sites", tags=["sites"])


async def _public_handoff_state(db, site_id: str) -> dict:
    """Handoff availability for the public widget config."""
    stored = await db.get_site_handoff_config(site_id) or {}
    return {
        "enabled": stored.get("enabled", True),
        "has_agents": await db.has_assigned_agents(site_id),
    }


@router.get("")
async def list_sites(user: dict = Depends(require_auth)):
    """Get sites for the current user (or all sites for admin)."""
    db = await get_mongodb()

    if is_agent(user):
        ids = user.get("assigned_site_ids") or []
        sites = await db.list_sites_by_site_ids(ids) if ids else []
    elif is_admin(user):
        sites = await db.list_sites(user_id=None)
    else:
        user_id = str(user["_id"])
        sites = await db.list_sites(user_id=user_id)
    
    result = []
    for site in sites:
        site_url = site.get("url", "")
        
        job = await db.get_crawl_job_by_url(site_url) if hasattr(db, 'get_crawl_job_by_url') else None
        
        job_status = job.get("status") if job else site.get("status", "pending")
        result.append({
            "site_id": site.get("site_id"),
            "name": site.get("name"),
            "url": site.get("url"),
            "favicon_url": site.get("favicon_url"),
            "user_id": site.get("user_id"),
            "status": job_status,
            "pages_crawled": job.get("pages_crawled", 0) if job else 0,
            "pages_indexed": job.get("pages_indexed", 0) if job else 0,
            "created_at": site.get("created_at"),
            "error": job.get("errors", [])[-1] if job and job_status == "failed" and job.get("errors") else None
        })
    
    return result


@router.get("/{site_id}")
async def get_site(site_id: str, user: dict = Depends(require_auth)):
    """Get a specific site by ID."""
    db = await get_mongodb()
    
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    if not can_view_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")
    
    job = await db.get_crawl_job_by_url(site.get("url", "")) if hasattr(db, 'get_crawl_job_by_url') else None
    
    return {
        "site_id": site.get("site_id"),
        "name": site.get("name"),
        "url": site.get("url"),
        "favicon_url": site.get("favicon_url"),
        "user_id": site.get("user_id"),
        "status": job.get("status") if job else site.get("status", "pending"),
        "pages_crawled": job.get("pages_crawled", 0) if job else 0,
        "pages_indexed": job.get("pages_indexed", 0) if job else 0
    }


class SiteMetaUpdate(BaseModel):
    """Site-level metadata (name, favicon) — not part of the public widget config."""
    name: Optional[str] = None
    favicon_url: Optional[str] = None


@router.put("/{site_id}/meta")
async def update_site_meta(site_id: str, data: SiteMetaUpdate, user: dict = Depends(require_auth)):
    """Update site name and/or favicon (used by auto brand detection)."""
    db = await get_mongodb()
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")

    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if updates:
        await db.update_site(site_id, updates)
    return {"ok": True, **updates}


@router.delete("/{site_id}")
async def delete_site(site_id: str, user: dict = Depends(require_auth)):
    """Delete a site and all its data."""
    db = await get_mongodb()
    
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")
    
    url = site.get("url")
    
    try:
        await db.delete_site(site_id)
        
        try:
            vector_store = get_vector_store()
            await vector_store.delete_by_metadata({"source_url": {"$regex": f"^{url}"}})
        except Exception as e:
            logger.warning(f"Could not delete vectors for site {url}: {e}")
        
        logger.info(f"Deleted site: {url}")
        return {"message": f"Site {site_id} deleted successfully"}
        
    except Exception as e:
        logger.error(f"Error deleting site {site_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete site")


# ==================== Site Configuration Endpoints ====================

@router.get("/{site_id}/config", response_model=SiteConfig)
async def get_site_config(site_id: str):
    """
    Get the configuration for a site.
    This endpoint is public as the widget needs to fetch config.
    """
    db = await get_mongodb()
    
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    config_data = site.get("config", {})
    config_data["handoff"] = await _public_handoff_state(db, site_id)
    return SiteConfig(**config_data) if config_data else SiteConfig()


@router.put("/{site_id}/config", response_model=SiteConfig)
async def update_site_config(
    site_id: str,
    config: SiteConfigUpdate,
    user: dict = Depends(require_auth)
):
    """Update the configuration for a site."""
    db = await get_mongodb()
    
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")
    
    current_config = site.get("config", {})

    # Merge each sent section key-by-key over the stored one instead of
    # replacing it: a partial payload (e.g. brand-apply sending only two
    # appearance fields) must not reset the rest of the section to defaults.
    update_data = {}
    for name in ("appearance", "behavior", "lead_capture", "security",
                 "quick_prompts", "help_center", "visibility", "session"):
        section = getattr(config, name)
        if section is None:
            continue
        sent = section.model_dump(exclude_unset=True)
        if not sent:
            continue
        stored = current_config.get(name) or {}
        update_data[f"config.{name}"] = {**stored, **sent}
    
    if update_data:
        # For provider interface, flatten update_data for update_site method
        merged_config = current_config.copy()
        for key, value in update_data.items():
            # key is like "config.appearance", need to extract just "appearance"
            config_key = key.replace("config.", "")
            merged_config[config_key] = value
        
        await db.update_site(site_id, {"config": merged_config})
    
    updated_site = await db.get_site(site_id)
    updated_config = updated_site.get("config", {})
    updated_config["handoff"] = await _public_handoff_state(db, site_id)

    return SiteConfig(**updated_config) if updated_config else SiteConfig()


@router.post("/{site_id}/config/reset", response_model=SiteConfig)
async def reset_site_config(
    site_id: str,
    user: dict = Depends(require_auth)
):
    """Reset the site configuration to defaults."""
    db = await get_mongodb()
    
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")
    
    default_config = SiteConfig()
    default_config_dict = default_config.model_dump()
    default_config_dict.pop("handoff", None)  # computed dynamically, never stored

    await db.update_site(site_id, {"config": default_config_dict})
    
    return default_config


@router.put("/{site_id}/quick-prompts", response_model=SiteQuickPromptsConfig)
async def update_quick_prompts(
    site_id: str,
    quick_prompts: SiteQuickPromptsConfig,
    user: dict = Depends(require_auth)
):
    """Update quick prompts configuration for a site."""
    db = await get_mongodb()
    
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")
    
    current_config = site.get("config", {})
    current_config["quick_prompts"] = quick_prompts.model_dump()
    
    await db.update_site(site_id, {"config": current_config})
    
    return quick_prompts


@router.get("/{site_id}/quick-prompts", response_model=SiteQuickPromptsConfig)
async def get_quick_prompts(site_id: str):
    """
    Get quick prompts configuration for a site.
    This endpoint is public as the widget needs to fetch config.
    """
    db = await get_mongodb()
    
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    config_data = site.get("config", {})
    quick_prompts_data = config_data.get("quick_prompts", {})
    
    return SiteQuickPromptsConfig(**quick_prompts_data) if quick_prompts_data else SiteQuickPromptsConfig()


# ==================== Push Notifications (OneSignal) ====================
# Stored at site.notifications (NOT site.config) so the REST API key is
# never exposed through the public widget config endpoint.


def _notifications_response(conf: dict) -> dict:
    """Mask the REST API key in responses."""
    out = dict(conf or {})
    key = out.pop("onesignal_rest_api_key", None)
    out["has_api_key"] = bool(key)
    if key:
        out["api_key_hint"] = f"••••{key[-4:]}"
    return out


@router.get("/{site_id}/notifications")
async def get_notifications_config(site_id: str, user: dict = Depends(require_auth)):
    """Get push notification settings for a site (API key masked)."""
    db = await get_mongodb()

    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")

    return _notifications_response(site.get("notifications") or SiteNotificationsConfig().model_dump())


@router.put("/{site_id}/notifications")
async def update_notifications_config(
    site_id: str,
    notifications: SiteNotificationsConfig,
    user: dict = Depends(require_auth)
):
    """Update push notification settings for a site/channel."""
    db = await get_mongodb()

    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")

    data = notifications.model_dump()
    # Keep existing key when the client leaves it blank (masked UI pattern)
    if not data.get("onesignal_rest_api_key"):
        existing = (site.get("notifications") or {}).get("onesignal_rest_api_key")
        data["onesignal_rest_api_key"] = existing

    await db.update_site(site_id, {"notifications": data})
    return _notifications_response(data)


# ==================== Knowledge: extra webpage URLs ====================
# Stored at site.knowledge_urls — crawled pages are matched in RAG retrieval
# by URL prefix (see rag_engine._retrieve_documents).


class KnowledgeUrlBody(BaseModel):
    url: str
    max_pages: int = 10


def _normalize_knowledge_url(raw: str) -> str:
    url = (raw or "").strip().rstrip("/")
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


@router.get("/{site_id}/knowledge/urls")
async def list_knowledge_urls(site_id: str, user: dict = Depends(require_auth)):
    """List extra webpage URLs indexed as knowledge for this site."""
    db = await get_mongodb()
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not can_view_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")

    entries = site.get("knowledge_urls") or []
    result = []
    for entry in entries:
        job = await db.get_crawl_job_by_url(entry.get("url", "")) if hasattr(db, "get_crawl_job_by_url") else None
        result.append({
            "url": entry.get("url"),
            "added_at": entry.get("added_at"),
            "status": (job or {}).get("status", entry.get("status", "completed")),
            "pages_indexed": (job or {}).get("pages_indexed", entry.get("pages_indexed", 0)),
        })
    return {"urls": result}


@router.post("/{site_id}/knowledge/urls")
async def add_knowledge_url(
    site_id: str,
    body: KnowledgeUrlBody,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth),
):
    """Register an extra webpage URL and crawl/index it into the site's knowledge."""
    db = await get_mongodb()
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")

    url = _normalize_knowledge_url(body.url)
    if not url:
        raise HTTPException(status_code=400, detail="A valid URL is required")

    entries = site.get("knowledge_urls") or []
    if not any(e.get("url") == url for e in entries):
        entries.append({"url": url, "added_at": datetime.utcnow(), "status": "running"})
        await db.update_site(site_id, {"knowledge_urls": entries})

    job_id = await db.create_crawl_job(url)
    from app.routes.crawl import _crawl_and_index
    background_tasks.add_task(_crawl_and_index, job_id, url, min(body.max_pages, 100), [], [])

    return {"success": True, "url": url, "job_id": job_id, "status": "running"}


@router.delete("/{site_id}/knowledge/urls")
async def delete_knowledge_url(
    site_id: str,
    url: str,
    user: dict = Depends(require_auth),
):
    """Remove an extra knowledge URL and its indexed pages."""
    db = await get_mongodb()
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")

    normalized = _normalize_knowledge_url(url)
    entries = [e for e in (site.get("knowledge_urls") or []) if e.get("url") != normalized]
    await db.update_site(site_id, {"knowledge_urls": entries})

    try:
        vector_store = get_vector_store()
        vector_store.delete_by_metadata({"url": {"$regex": f"^{normalized}"}})
    except Exception as e:
        logger.warning(f"Could not delete vectors for knowledge URL {normalized}: {e}")

    return {"success": True}


@router.post("/{site_id}/notifications/test")
async def test_notifications(site_id: str, user: dict = Depends(require_auth)):
    """Send a test push notification for this site."""
    from app.services.notifications import send_push

    db = await get_mongodb()

    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")

    ok = await send_push(
        site_id,
        "new_message",
        "SwiftChat test notification",
        "If you can see this, push notifications are working.",
        context={"session_id": "test", "test": True},
        url=None,
    )
    if not ok:
        raise HTTPException(status_code=400, detail="Push not sent — check that notifications are enabled and OneSignal credentials are set")
    return {"success": True}
