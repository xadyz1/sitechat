"""
AI content pipeline — scheduled post drafting, manual approval, API publish.

Posts live in the `content_posts` collection; per-site settings live on the
site doc at `config.content` (SiteContentConfig). A scheduler tick scans for
due posts every minute and drafts them with the configured LLM. Nothing
publishes without an explicit dashboard approval.
"""
import json
import re
from datetime import datetime
from typing import Any, Dict, Optional

import httpx
from loguru import logger

from app.services.ollama import get_ollama_service

POST_STATUSES = (
    "scheduled", "drafting", "pending_review",
    "publishing", "published", "rejected", "failed",
)

_PUBLISH_TIMEOUT = 30


def _site_content_config(site: Dict[str, Any]) -> Dict[str, Any]:
    return (site.get("config") or {}).get("content") or {}


async def generate_draft(site: Dict[str, Any], post: Dict[str, Any]) -> Dict[str, Any]:
    """Draft a post with the LLM. Returns {title, summary, html, meta_description, tags}."""
    cfg = _site_content_config(site)
    site_name = site.get("name") or site.get("domain") or "the site"
    site_url = site.get("url") or ""
    author = cfg.get("author_name") or "AI Writer"
    voice = cfg.get("voice_instructions") or ""

    system_prompt = (
        f"You are {author}, the staff writer for {site_name} ({site_url}).\n"
        f"{voice}\n"
        "Write a blog post for the site's online magazine.\n"
        "Respond with ONLY a JSON object (no markdown fences) with keys:\n"
        '{"title": "...", "summary": "1-2 sentence teaser", '
        '"html": "the article body in clean HTML (h2/h3/p/ul/strong only, no '
        'html/body wrappers)", "meta_description": "SEO description, max 160 '
        'chars", "tags": ["tag1", "tag2"]}'
    )
    prompt = f"Brief: {post.get('brief', '')}"
    if post.get("instructions"):
        prompt += f"\n\nAdditional instructions for this post: {post['instructions']}"

    raw = await get_ollama_service().generate(
        prompt, system_prompt=system_prompt, temperature=0.7, max_tokens=4000
    )
    return _parse_draft(raw)


def _parse_draft(raw: str) -> Dict[str, Any]:
    """Parse the LLM JSON response, tolerating fences/prose around it."""
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, flags=re.S)
        data = json.loads(m.group(0)) if m else {}
    if not isinstance(data, dict) or not data.get("html"):
        # Fallback: treat the whole reply as the article body
        return {
            "title": "Untitled post",
            "summary": "",
            "html": f"<p>{text}</p>" if text else "",
            "meta_description": "",
            "tags": [],
        }
    tags = data.get("tags")
    return {
        "title": str(data.get("title") or "Untitled post")[:300],
        "summary": str(data.get("summary") or ""),
        "html": str(data.get("html") or ""),
        "meta_description": str(data.get("meta_description") or "")[:160],
        "tags": [str(t) for t in tags] if isinstance(tags, list) else [],
    }


def build_image_url(site: Dict[str, Any], post: Dict[str, Any], seed: int = 0) -> str:
    """On-demand featured image via pollinations.ai — free, keyless.

    The URL generates the image when first fetched, so we store it directly.
    Change seed to regenerate a different image for the same brief.
    """
    import random
    from urllib.parse import quote
    cfg = _site_content_config(site)
    voice = (cfg.get("voice_instructions") or "")[:200]
    subject = post.get("title") or post.get("brief") or "editorial article"
    prompt = (
        f"editorial magazine cover photo for: {subject}. "
        f"{voice} photographic, no text, no watermark"
    )
    return (
        "https://image.pollinations.ai/prompt/"
        + quote(prompt, safe="")
        + f"?width=1200&height=630&nologo=true&model=flux&seed={seed or random.randint(1, 99999)}"
    )


def _slugify(title: str) -> str:
    import unicodedata
    ascii_title = unicodedata.normalize("NFKD", title or "").encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_title.lower()).strip("-")
    return slug or "post"


async def publish_post(site: Dict[str, Any], post: Dict[str, Any]) -> None:
    """POST the approved article to the site's publish endpoint."""
    cfg = _site_content_config(site)
    url = cfg.get("publish_url")
    if not url:
        raise ValueError("No publish endpoint configured for this site")

    payload = {
        "title": post.get("title") or "Untitled post",
        "slug": _slugify(post.get("title") or post.get("brief") or ""),
        "summary": post.get("summary") or "",
        "html": post.get("draft_html") or "",
        "meta_description": post.get("meta_description") or "",
        "tags": post.get("tags") or [],
        "image_url": post.get("image_url") or None,
        "author": cfg.get("author_name") or "AI Writer",
        "scheduled_at": post["scheduled_at"].isoformat() if post.get("scheduled_at") else None,
        "site_id": site.get("site_id"),
    }
    headers = {"Content-Type": "application/json"}
    if cfg.get("publish_secret"):
        headers["Authorization"] = f"Bearer {cfg['publish_secret']}"

    async with httpx.AsyncClient(timeout=_PUBLISH_TIMEOUT) as client:
        res = await client.post(url, json=payload, headers=headers)
    if res.status_code >= 400:
        raise ValueError(f"Publish endpoint returned {res.status_code}: {res.text[:300]}")


async def _set_status(db, post_id: str, **fields):
    fields["updated_at"] = datetime.utcnow()
    await db.db.content_posts.update_one({"post_id": post_id}, {"$set": fields})


async def draft_post(db, post_id: str) -> Optional[Dict[str, Any]]:
    """Generate the draft for one post. Returns the updated post."""
    post = await db.db.content_posts.find_one({"post_id": post_id})
    if not post or post.get("status") in ("published", "publishing"):
        return post
    site = await db.get_site(post["site_id"])
    if not site:
        await _set_status(db, post_id, status="failed", error="Site not found")
        return post

    await _set_status(db, post_id, status="drafting", error=None)
    try:
        draft = await generate_draft(site, post)
        await _set_status(
            db, post_id,
            status="pending_review",
            title=draft["title"],
            summary=draft["summary"],
            draft_html=draft["html"],
            meta_description=draft["meta_description"],
            tags=draft["tags"],
        )
    except Exception as e:
        logger.error(f"Content draft failed for {post_id}: {e}")
        await _set_status(db, post_id, status="failed", error=str(e)[:500])
    return await db.db.content_posts.find_one({"post_id": post_id})


async def approve_post(db, post_id: str) -> Optional[Dict[str, Any]]:
    """Publish an approved post to the site's endpoint."""
    post = await db.db.content_posts.find_one({"post_id": post_id})
    if not post:
        return None
    if post.get("status") != "pending_review":
        raise ValueError("Post must be in review before approving")
    site = await db.get_site(post["site_id"])
    if not site:
        raise ValueError("Site not found")

    await _set_status(db, post_id, status="publishing", error=None)
    try:
        await publish_post(site, post)
        await _set_status(db, post_id, status="published", published_at=datetime.utcnow())
    except Exception as e:
        logger.error(f"Publish failed for {post_id}: {e}")
        # Back to review so it can be retried after fixing the endpoint
        await _set_status(db, post_id, status="pending_review", error=str(e)[:500])
        raise
    return await db.db.content_posts.find_one({"post_id": post_id})


async def process_due_posts(db) -> int:
    """Draft every scheduled post whose time has come. Called by the scheduler tick."""
    due = await db.db.content_posts.find({
        "status": "scheduled",
        "scheduled_at": {"$lte": datetime.utcnow()},
    }).to_list(50)

    for post in due:
        site = await db.get_site(post["site_id"])
        if not site or not _site_content_config(site).get("enabled"):
            continue
        await draft_post(db, post["post_id"])
    return len(due)
