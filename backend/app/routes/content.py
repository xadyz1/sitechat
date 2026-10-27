"""
AI content pipeline routes — queue, schedule, draft, approve, publish.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger

from app.database import get_mongodb
from app.routes.auth import require_auth
from app.core.site_access import can_manage_site
from app.models.schemas import (
    ContentPostCreate, ContentPostUpdate, SiteContentConfig,
)
from app.services import content as content_service

router = APIRouter(prefix="/api/sites/{site_id}/content", tags=["content"])


async def _require_site(db, site_id: str, user: dict) -> dict:
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")
    return site


def _serialize(post: dict) -> dict:
    post = dict(post)
    post.pop("_id", None)
    return post


@router.get("")
async def get_content_state(site_id: str, user: dict = Depends(require_auth)):
    """Settings + all posts for a site."""
    db = await get_mongodb()
    site = await _require_site(db, site_id, user)
    cfg = (site.get("config") or {}).get("content") or {}
    posts = await db.db.content_posts.find(
        {"site_id": site_id}, {"_id": 0}
    ).sort([("scheduled_at", 1), ("created_at", -1)]).to_list(200)
    # Never send the publish secret back to the client
    safe_cfg = {k: v for k, v in cfg.items() if k != "publish_secret"}
    safe_cfg["has_secret"] = bool(cfg.get("publish_secret"))
    return {"settings": safe_cfg, "posts": posts}


@router.put("/settings")
async def update_content_settings(
    site_id: str,
    settings: SiteContentConfig,
    user: dict = Depends(require_auth),
):
    db = await get_mongodb()
    site = await _require_site(db, site_id, user)

    update = settings.model_dump()
    # Empty secret field means "keep the existing one"
    if not update.get("publish_secret"):
        existing = (site.get("config") or {}).get("content") or {}
        update["publish_secret"] = existing.get("publish_secret")

    await db.update_site(site_id, {"config.content": update})
    return {"ok": True}


@router.post("/posts")
async def create_post(
    site_id: str,
    body: ContentPostCreate,
    user: dict = Depends(require_auth),
):
    db = await get_mongodb()
    site = await _require_site(db, site_id, user)
    cfg = (site.get("config") or {}).get("content") or {}

    now = datetime.utcnow()
    draft_now = body.scheduled_at is None or body.scheduled_at <= now
    doc = {
        "post_id": uuid.uuid4().hex[:16],
        "site_id": site_id,
        "brief": body.brief,
        "instructions": body.instructions,
        "scheduled_at": body.scheduled_at,
        "status": "scheduled",
        "created_at": now,
        "updated_at": now,
    }
    await db.db.content_posts.insert_one(doc)
    doc.pop("_id", None)

    if draft_now and cfg.get("enabled"):
        import asyncio
        asyncio.create_task(content_service.draft_post(db, doc["post_id"]))
    return doc


@router.put("/posts/{post_id}")
async def update_post(
    site_id: str,
    post_id: str,
    body: ContentPostUpdate,
    user: dict = Depends(require_auth),
):
    db = await get_mongodb()
    await _require_site(db, site_id, user)

    post = await db.db.content_posts.find_one({"post_id": post_id, "site_id": site_id})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.get("status") in ("published", "publishing"):
        raise HTTPException(status_code=400, detail="Published posts cannot be edited")

    update = body.model_dump(exclude_unset=True)
    if not update:
        return _serialize(post)
    update["updated_at"] = datetime.utcnow()
    await db.db.content_posts.update_one({"post_id": post_id}, {"$set": update})
    return _serialize(await db.db.content_posts.find_one({"post_id": post_id}))


@router.delete("/posts/{post_id}")
async def delete_post(site_id: str, post_id: str, user: dict = Depends(require_auth)):
    db = await get_mongodb()
    await _require_site(db, site_id, user)
    result = await db.db.content_posts.delete_one({"post_id": post_id, "site_id": site_id})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"ok": True}


@router.post("/posts/{post_id}/generate")
async def generate_now(site_id: str, post_id: str, user: dict = Depends(require_auth)):
    db = await get_mongodb()
    await _require_site(db, site_id, user)
    post = await content_service.draft_post(db, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.get("status") == "failed":
        raise HTTPException(status_code=502, detail=post.get("error") or "Draft generation failed")
    return _serialize(post)


@router.post("/posts/{post_id}/approve")
async def approve(site_id: str, post_id: str, user: dict = Depends(require_auth)):
    db = await get_mongodb()
    await _require_site(db, site_id, user)
    try:
        post = await content_service.approve_post(db, post_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)[:300])
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return _serialize(post)


@router.post("/posts/{post_id}/image")
async def generate_image(site_id: str, post_id: str, user: dict = Depends(require_auth)):
    """Generate (or regenerate) a featured image URL for a draft."""
    db = await get_mongodb()
    site = await _require_site(db, site_id, user)
    post = await db.db.content_posts.find_one({"post_id": post_id, "site_id": site_id})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.get("status") == "published":
        raise HTTPException(status_code=400, detail="Post already published")

    image_url = content_service.build_image_url(site, post)
    await db.db.content_posts.update_one(
        {"post_id": post_id},
        {"$set": {"image_url": image_url, "updated_at": datetime.utcnow()}},
    )
    return {"image_url": image_url}


@router.post("/posts/{post_id}/reject")
async def reject(site_id: str, post_id: str, user: dict = Depends(require_auth)):
    db = await get_mongodb()
    await _require_site(db, site_id, user)
    result = await db.db.content_posts.update_one(
        {"post_id": post_id, "site_id": site_id, "status": "pending_review"},
        {"$set": {"status": "rejected", "updated_at": datetime.utcnow()}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Post not found or not in review")
    return {"ok": True}
