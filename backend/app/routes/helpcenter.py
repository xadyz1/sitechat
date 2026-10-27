"""
Help Center API routes.

Serves synced help-center content to the chat widget (public) and exposes
sync/management endpoints to the dashboard (authenticated).
"""
import re
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from loguru import logger
from pydantic import BaseModel

from app.config import settings
from app.database import get_mongodb
from app.routes.auth import require_auth
from app.core.site_access import can_manage_site
from app.services.helpcenter import HelpCenterService, get_help_overview, get_help_article

router = APIRouter(prefix="/api/sites/{site_id}/help", tags=["help-center"])


@router.get("")
async def get_help_center(site_id: str):
    """
    Public endpoint — returns categories and article summaries for the widget.
    """
    db = await get_mongodb()
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    config = (site.get("config") or {}).get("help_center") or {}
    if not config.get("enabled", False):
        raise HTTPException(status_code=404, detail="Help center not enabled")

    data = await get_help_overview(db, site_id)
    return {
        "tab_label": config.get("tab_label") or "Help",
        "categories": data["categories"],
        "articles": data["articles"],
    }


@router.get("/articles/{slug}")
async def get_help_center_article(site_id: str, slug: str):
    """Public endpoint — returns a single article's rendered body."""
    db = await get_mongodb()
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    config = (site.get("config") or {}).get("help_center") or {}
    if not config.get("enabled", False):
        raise HTTPException(status_code=404, detail="Help center not enabled")

    article = await get_help_article(db, site_id, slug)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return article


@router.get("/status")
async def get_help_center_status(site_id: str, user: dict = Depends(require_auth)):
    """Dashboard: sync status + counts."""
    db = await get_mongodb()
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")

    hc = site.get("help_center") or {}
    categories = await db.db.help_categories.count_documents({"site_id": site_id})
    articles = await db.db.help_articles.count_documents({"site_id": site_id})
    return {
        "last_synced_at": hc.get("last_synced_at"),
        "last_sync_stats": hc.get("last_sync_stats"),
        "categories": categories,
        "articles": articles,
    }


@router.post("/sync")
async def sync_help_center(site_id: str, background_tasks: BackgroundTasks,
                           user: dict = Depends(require_auth)):
    """
    Dashboard: re-scrape the configured portal_url into MongoDB.
    Runs in the background — poll /status for results.
    """
    db = await get_mongodb()
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")

    config = (site.get("config") or {}).get("help_center") or {}
    portal_url = config.get("portal_url")
    if not portal_url:
        raise HTTPException(status_code=400, detail="help_center.portal_url is not configured")

    service = HelpCenterService(db)

    async def _run():
        try:
            await service.sync_portal(site_id, portal_url)
        except Exception as e:
            logger.error(f"Help center sync failed for {site_id}: {e}")

    background_tasks.add_task(_run)
    return {"status": "syncing", "portal_url": portal_url}


# ==================== Content management (categories + articles) ====================

class CategoryBody(BaseModel):
    name: str
    slug: Optional[str] = None
    locale: Optional[str] = "en"
    icon: Optional[str] = None
    icon_url: Optional[str] = None
    description: Optional[str] = None


class ArticleBody(BaseModel):
    title: str
    slug: Optional[str] = None
    category_slug: Optional[str] = None
    locale: Optional[str] = "en"
    content_html: Optional[str] = ""
    excerpt: Optional[str] = None


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug or "item"


async def _manage_site(db, site_id: str, user: dict) -> dict:
    site = await db.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not can_manage_site(user, site):
        raise HTTPException(status_code=403, detail="Access denied")
    return site


async def _unique_slug(db, site_id: str, base: str, locale: str, current_slug: Optional[str] = None) -> str:
    """Unique article/category slug within a site+locale."""
    slug, n = base, 2
    while True:
        existing = await db.db.help_articles.find_one(
            {"site_id": site_id, "slug": slug, "$or": [{"locale": locale}, {"locale": {"$exists": False}}]}
        )
        cat_existing = None
        if not existing:
            cat_existing = await db.db.help_categories.find_one(
                {"site_id": site_id, "slug": slug, "$or": [{"locale": locale}, {"locale": {"$exists": False}}]}
            )
        if not existing and not cat_existing:
            return slug
        if current_slug and slug == current_slug:
            return slug
        slug, n = f"{base}-{n}", n + 1


def _excerpt_from_html(html: str) -> str:
    from bs4 import BeautifulSoup
    return BeautifulSoup(html or "", "html.parser").get_text(" ", strip=True)[:220]


async def _refresh_category_counts(db, site_id: str):
    """Recompute article_count for every category of a site."""
    pipeline = [
        {"$match": {"site_id": site_id}},
        {"$group": {"_id": "$category_slug", "n": {"$sum": 1}}},
    ]
    counts = {d["_id"]: d["n"] async for d in db.db.help_articles.aggregate(pipeline)}
    async for cat in db.db.help_categories.find({"site_id": site_id}):
        n = counts.get(cat.get("slug"), 0)
        if cat.get("article_count") != n:
            await db.db.help_categories.update_one({"_id": cat["_id"]}, {"$set": {"article_count": n}})


@router.get("/manage")
async def manage_content(site_id: str, user: dict = Depends(require_auth)):
    """Dashboard: full category + article list for editing."""
    db = await get_mongodb()
    await _manage_site(db, site_id, user)
    categories = await db.db.help_categories.find(
        {"site_id": site_id}, {"_id": 0}
    ).sort([("locale", 1), ("name", 1)]).to_list(500)
    articles = await db.db.help_articles.find(
        {"site_id": site_id}, {"_id": 0}
    ).sort([("locale", 1), ("title", 1)]).to_list(5000)
    for a in articles:
        if isinstance(a.get("updated_at"), datetime):
            a["updated_at"] = a["updated_at"].isoformat()
    return {"categories": categories, "articles": articles}


@router.post("/categories")
async def create_category(site_id: str, body: CategoryBody, user: dict = Depends(require_auth)):
    db = await get_mongodb()
    await _manage_site(db, site_id, user)
    locale = (body.locale or "en").lower()
    slug = await _unique_slug(db, site_id, _slugify(body.slug or body.name), locale)
    doc = {
        "site_id": site_id, "slug": slug, "name": body.name.strip(), "locale": locale,
        "icon": (body.icon or "").strip()[:8] or None,
        "icon_url": body.icon_url or None,
        "description": body.description or None,
        "article_count": 0, "updated_at": datetime.utcnow(),
    }
    await db.db.help_categories.insert_one(doc)
    doc.pop("_id", None)
    if isinstance(doc.get("updated_at"), datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
    return doc


@router.put("/categories/{slug}")
async def update_category(site_id: str, slug: str, body: CategoryBody,
                          locale: Optional[str] = None, user: dict = Depends(require_auth)):
    db = await get_mongodb()
    await _manage_site(db, site_id, user)
    q = {"site_id": site_id, "slug": slug}
    if locale:
        q["locale"] = locale.lower()
    update = {
        "name": body.name.strip(),
        "icon": (body.icon or "").strip()[:8] or None,
        "icon_url": body.icon_url or None,
        "description": body.description or None,
        "updated_at": datetime.utcnow(),
    }
    result = await db.db.help_categories.update_one(q, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    cat = await db.db.help_categories.find_one(q, {"_id": 0})
    if isinstance(cat.get("updated_at"), datetime):
        cat["updated_at"] = cat["updated_at"].isoformat()
    return cat


@router.delete("/categories/{slug}")
async def delete_category(site_id: str, slug: str, locale: Optional[str] = None,
                          user: dict = Depends(require_auth)):
    """Delete a category; its articles become uncategorised rather than deleted."""
    db = await get_mongodb()
    await _manage_site(db, site_id, user)
    q = {"site_id": site_id, "slug": slug}
    if locale:
        q["locale"] = locale.lower()
    result = await db.db.help_categories.delete_many(q)
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    await db.db.help_articles.update_many(
        {"site_id": site_id, "category_slug": slug}, {"$set": {"category_slug": ""}}
    )
    return {"success": True}


@router.post("/articles")
async def create_article(site_id: str, body: ArticleBody, user: dict = Depends(require_auth)):
    db = await get_mongodb()
    await _manage_site(db, site_id, user)
    locale = (body.locale or "en").lower()
    slug = await _unique_slug(db, site_id, _slugify(body.slug or body.title), locale)
    content_html = HelpCenterService.sanitize_article_html(body.content_html or "")
    doc = {
        "site_id": site_id, "slug": slug, "title": body.title.strip(), "locale": locale,
        "category_slug": body.category_slug or "",
        "content_html": content_html,
        "excerpt": (body.excerpt or "").strip() or _excerpt_from_html(content_html),
        "url": None, "updated_at": datetime.utcnow(),
    }
    await db.db.help_articles.insert_one(doc)
    await _refresh_category_counts(db, site_id)
    doc.pop("_id", None)
    if isinstance(doc.get("updated_at"), datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
    return doc


@router.put("/articles/{slug}")
async def update_article(site_id: str, slug: str, body: ArticleBody,
                         locale: Optional[str] = None, user: dict = Depends(require_auth)):
    db = await get_mongodb()
    await _manage_site(db, site_id, user)
    q = {"site_id": site_id, "slug": slug}
    if locale:
        q["locale"] = locale.lower()
    content_html = HelpCenterService.sanitize_article_html(body.content_html or "")
    update = {
        "title": body.title.strip(),
        "category_slug": body.category_slug or "",
        "content_html": content_html,
        "excerpt": (body.excerpt or "").strip() or _excerpt_from_html(content_html),
        "updated_at": datetime.utcnow(),
    }
    result = await db.db.help_articles.update_one(q, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Article not found")
    await _refresh_category_counts(db, site_id)
    article = await db.db.help_articles.find_one(q, {"_id": 0})
    if isinstance(article.get("updated_at"), datetime):
        article["updated_at"] = article["updated_at"].isoformat()
    return article


@router.delete("/articles/{slug}")
async def delete_article(site_id: str, slug: str, locale: Optional[str] = None,
                         user: dict = Depends(require_auth)):
    db = await get_mongodb()
    await _manage_site(db, site_id, user)
    q = {"site_id": site_id, "slug": slug}
    if locale:
        q["locale"] = locale.lower()
    result = await db.db.help_articles.delete_many(q)
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Article not found")
    await _refresh_category_counts(db, site_id)
    return {"success": True}


# ==================== Custom domain ====================

def _dns_records(domain: str) -> dict:
    """Resolve CNAME/A/AAAA for a domain; empty lists when unresolvable."""
    records = {"cname": [], "a": [], "aaaa": []}
    try:
        import dns.resolver
        resolver = dns.resolver.Resolver()
        resolver.lifetime = 8
        for rtype, key in (("CNAME", "cname"), ("A", "a"), ("AAAA", "aaaa")):
            try:
                for r in resolver.resolve(domain, rtype):
                    records[key].append(str(r).rstrip("."))
            except Exception:
                pass
    except ImportError:
        import socket
        try:
            records["a"] = [socket.gethostbyname(domain)]
        except Exception:
            pass
    return records


@router.post("/domain/verify")
async def verify_custom_domain(site_id: str, user: dict = Depends(require_auth)):
    """
    Check DNS for the configured help_center.custom_domain.
    Verified when a CNAME points at this server, or its A/AAAA records
    match this server's resolved addresses.
    """
    db = await get_mongodb()
    site = await _manage_site(db, site_id, user)

    hc = (site.get("config") or {}).get("help_center") or {}
    domain = (hc.get("custom_domain") or "").strip().lower()
    if not domain:
        raise HTTPException(status_code=400, detail="No custom domain configured")

    records = _dns_records(domain)
    server_host = (urlparse(settings.SITE_URL).hostname or "").lower()
    verified = False
    if server_host:
        targets = {h.lower().rstrip(".") for h in records["cname"]}
        if server_host in targets:
            verified = True
        else:
            try:
                server_ips = set(_dns_records(server_host)["a"])
            except Exception:
                server_ips = set()
            if server_ips and server_ips & set(records["a"] + records["aaaa"]):
                verified = True

    await db.db.sites.update_one(
        {"site_id": site_id},
        {"$set": {"help_center.domain_verified": verified,
                  "help_center.domain_checked_at": datetime.utcnow()}},
    )
    return {"domain": domain, "verified": verified, "records": records,
            "expected": server_host or None}


@router.get("/domain/status")
async def custom_domain_status(site_id: str, user: dict = Depends(require_auth)):
    db = await get_mongodb()
    site = await _manage_site(db, site_id, user)
    hc = (site.get("config") or {}).get("help_center") or {}
    stored = site.get("help_center") or {}
    server_host = (urlparse(settings.SITE_URL).hostname or "").lower()
    return {
        "custom_domain": hc.get("custom_domain"),
        "verified": stored.get("domain_verified", False),
        "checked_at": stored.get("domain_checked_at"),
        "expected": server_host or None,
    }
