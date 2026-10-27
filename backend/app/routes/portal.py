"""
Public help center portal.

Serves a SwiftChat-hosted, public-facing help portal per site at
``/hc/{site_id-or-slug}`` — built from the articles synced by the help-center
scraper (see ``app/services/helpcenter.py``). The same content feeds the
in-widget Help tab via ``/api/sites/{site_id}/help``.
"""
import os
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.database import get_mongodb

router = APIRouter(prefix="/hc", tags=["help-portal"])

_templates_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")
templates = Jinja2Templates(directory=_templates_dir)

LOCALE_NAMES = {
    "en": "English", "pt": "Português", "pt-br": "Português (Brasil)",
    "es": "Español", "fr": "Français", "de": "Deutsch", "it": "Italiano",
    "nl": "Nederlands", "pl": "Polski", "tr": "Türkçe", "ar": "العربية",
    "ja": "日本語", "zh": "中文", "zh-cn": "中文 (简体)", "hi": "हिन्दी",
    "ru": "Русский", "ko": "한국어", "sv": "Svenska", "da": "Dansk",
}


async def _resolve_site(db, identifier: str) -> Optional[dict]:
    """Find a portal site by custom slug or site_id."""
    site = await db.db.sites.find_one({"config.help_center.slug": identifier})
    if site:
        return site
    return await db.get_site(identifier)


def _toc(content_html: str):
    """Inject anchor ids into h2/h3 headings; return the TOC entries."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return content_html, []
    soup = BeautifulSoup(content_html or "", "html.parser")
    toc, seen = [], set()
    for tag in soup.find_all(["h2", "h3"]):
        text = tag.get_text(" ", strip=True)
        if not text:
            continue
        anchor = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "section"
        base, n = anchor, 2
        while anchor in seen:
            anchor, n = f"{base}-{n}", n + 1
        seen.add(anchor)
        tag["id"] = anchor
        toc.append({"id": anchor, "text": text, "level": tag.name})
    return str(soup), toc


async def _portal_context(request: Request, identifier: str) -> tuple:
    """Site + help-center config for a public portal, or 404."""
    db = await get_mongodb()
    site = await _resolve_site(db, identifier)
    if not site:
        raise HTTPException(status_code=404, detail="Help center not found")

    hc = (site.get("config") or {}).get("help_center") or {}
    if not hc.get("enabled", False):
        raise HTTPException(status_code=404, detail="Help center not enabled")

    site_id = site.get("site_id", identifier)
    site_name = site.get("name") or site.get("domain") or "Help"
    portal_name = hc.get("portal_name") or site_name

    # Locale: explicit ?locale= > remembered cookie > configured default
    locales = [l.lower() for l in (hc.get("locales") or ["en"])]
    default_locale = (hc.get("default_locale") or "en").lower()
    if default_locale not in locales:
        locales.insert(0, default_locale)
    cookie_locale = (request.cookies.get(f"hc_locale_{site_id}") or "").lower()
    req_locale = (request.query_params.get("locale") or "").lower()
    active_locale = req_locale or cookie_locale or default_locale
    if active_locale not in locales:
        active_locale = default_locale

    # Docs synced before locales existed have no `locale` field — treat as default
    if active_locale == default_locale:
        locale_q = {"$or": [{"locale": active_locale}, {"locale": {"$exists": False}}]}
    else:
        locale_q = {"locale": active_locale}

    categories = await db.db.help_categories.find(
        {"site_id": site_id, **locale_q}, {"_id": 0}
    ).sort("name", 1).to_list(200)

    # On a custom domain the portal lives at the site root, so links are
    # root-relative; on the main host they live under /hc/{slug}.
    on_custom_domain = getattr(request.state, "hc_custom_domain", False)

    return db, {
        "site_id": site_id,
        "site_url": site.get("url") or site.get("domain") or "",
        "portal_name": portal_name,
        "portal_title": hc.get("portal_title") or f"{portal_name} | Help Center",
        "header_text": hc.get("header_text") or "Support Portal",
        "home_page_link": hc.get("home_page_link"),
        "brand_color": hc.get("brand_color") or "#7B3DFB",
        "logo_url": hc.get("logo_url"),
        "layout": hc.get("layout") or "documentation",
        "social_links": hc.get("social_links") or [],
        "embed_widget": hc.get("embed_widget", True),
        "categories_nav": categories,
        "locale_q": locale_q,
        "locales": [{"code": l, "name": LOCALE_NAMES.get(l, l.upper())} for l in locales],
        "active_locale": active_locale,
        "locale_name": LOCALE_NAMES.get(active_locale, active_locale.upper()),
        "base_path": "" if on_custom_domain else f"/hc/{hc.get('slug') or site_id}",
        "home_url": "/" if on_custom_domain else f"/hc/{hc.get('slug') or site_id}",
    }


@router.get("/{identifier}", response_class=HTMLResponse)
async def portal_home(request: Request, identifier: str):
    db, ctx = await _portal_context(request, identifier)
    recommended = await db.db.help_articles.find(
        {"site_id": ctx["site_id"], **ctx["locale_q"]},
        {"_id": 0, "slug": 1, "title": 1, "category_slug": 1},
    ).sort("title", 1).to_list(6)
    return templates.TemplateResponse(request, "helpcenter/index.html", {
        "categories": ctx["categories_nav"],
        "recommended": recommended,
        **{k: v for k, v in ctx.items() if k != "locale_q"},
    })


@router.get("/{identifier}/search.json")
async def portal_search_json(request: Request, identifier: str, q: str = ""):
    """Live-search endpoint for the portal's AJAX search box."""
    db, ctx = await _portal_context(request, identifier)
    q = (q or "").strip()
    results = []
    if len(q) >= 2:
        rx = {"$regex": re.escape(q), "$options": "i"}
        results = await db.db.help_articles.find(
            {"site_id": ctx["site_id"], **ctx["locale_q"],
             "$or": [{"title": rx}, {"excerpt": rx}]},
            {"_id": 0, "slug": 1, "title": 1, "excerpt": 1, "category_slug": 1},
        ).sort("title", 1).to_list(20)
    return {"results": results, "base_path": ctx["base_path"]}


@router.get("/{identifier}/search", response_class=HTMLResponse)
async def portal_search(request: Request, identifier: str, q: str = ""):
    db, ctx = await _portal_context(request, identifier)
    results = []
    q = (q or "").strip()
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        results = await db.db.help_articles.find(
            {"site_id": ctx["site_id"], **ctx["locale_q"],
             "$or": [{"title": rx}, {"excerpt": rx}]},
            {"_id": 0, "slug": 1, "title": 1, "excerpt": 1},
        ).sort("title", 1).to_list(100)
    return templates.TemplateResponse(request, "helpcenter/search.html", {
        "results": results,
        "q": q,
        **{k: v for k, v in ctx.items() if k != "locale_q"},
    })


@router.get("/{identifier}/categories/{slug}", response_class=HTMLResponse)
async def portal_category(request: Request, identifier: str, slug: str):
    db, ctx = await _portal_context(request, identifier)
    category = await db.db.help_categories.find_one(
        {"site_id": ctx["site_id"], "slug": slug, **ctx["locale_q"]}, {"_id": 0}
    )
    if not category:
        raise HTTPException(status_code=404, detail="Topic not found")
    articles = await db.db.help_articles.find(
        {"site_id": ctx["site_id"], "category_slug": slug, **ctx["locale_q"]},
        {"_id": 0, "content_html": 0},
    ).sort("title", 1).to_list(500)
    return templates.TemplateResponse(request, "helpcenter/category.html", {
        "category": category,
        "articles": articles,
        "sibling_articles": articles,
        **{k: v for k, v in ctx.items() if k != "locale_q"},
    })


@router.get("/{identifier}/articles/{slug}", response_class=HTMLResponse)
async def portal_article(request: Request, identifier: str, slug: str):
    db, ctx = await _portal_context(request, identifier)
    article = await db.db.help_articles.find_one(
        {"site_id": ctx["site_id"], "slug": slug, **ctx["locale_q"]}, {"_id": 0}
    )
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    category = None
    siblings = []
    if article.get("category_slug"):
        category = await db.db.help_categories.find_one(
            {"site_id": ctx["site_id"], "slug": article["category_slug"], **ctx["locale_q"]},
            {"_id": 0, "name": 1, "slug": 1},
        )
        siblings = await db.db.help_articles.find(
            {"site_id": ctx["site_id"], "category_slug": article["category_slug"],
             **ctx["locale_q"]},
            {"_id": 0, "slug": 1, "title": 1},
        ).sort("title", 1).to_list(100)
    content_html, toc = _toc(article.get("content_html") or "")
    article = {**article, "content_html": content_html}
    updated = article.get("updated_at")
    return templates.TemplateResponse(request, "helpcenter/article.html", {
        "article": article,
        "category": category,
        "sibling_articles": siblings,
        "toc": toc,
        "updated_display": updated.strftime("%b %-d, %Y") if updated else None,
        **{k: v for k, v in ctx.items() if k != "locale_q"},
    })
