"""
Help Center sync service.

Scrapes a public Chatwoot-style help center portal (e.g.
https://chat.swiftapps.cloud/hc/concha-ai/en) and stores categories and
articles in MongoDB so the chat widget can serve them inline.
"""
import asyncio
import re
from datetime import datetime
from typing import Dict, List, Optional
from urllib.parse import urljoin, urlparse

import aiohttp
from bs4 import BeautifulSoup
from loguru import logger

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; SwiftChatHelpBot/1.0)",
    "Accept": "text/html,application/xhtml+xml",
}
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30)
MAX_CATEGORIES = 40
MAX_ARTICLES_PER_CATEGORY = 100


def _abs(base: str, href: str) -> str:
    return urljoin(base + "/", href)


def _slug_id(url: str) -> str:
    """Last path segment of an article/category URL (e.g. '1788855414-creating-your-concha-account')."""
    return urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]


class HelpCenterService:
    """Syncs a public help center portal into MongoDB."""

    def __init__(self, db):
        self.db = db

    async def _fetch(self, session: aiohttp.ClientSession, url: str) -> Optional[BeautifulSoup]:
        try:
            async with session.get(url, headers=DEFAULT_HEADERS, timeout=REQUEST_TIMEOUT,
                                   allow_redirects=True) as resp:
                if resp.status != 200:
                    logger.warning(f"Help center fetch {url} -> {resp.status}")
                    return None
                html = await resp.text()
                return BeautifulSoup(html, "html.parser")
        except Exception as e:
            logger.warning(f"Help center fetch failed {url}: {e}")
            return None

    def _category_links(self, portal_url: str, soup: BeautifulSoup) -> List[Dict]:
        """Extract unique category links from the portal home page."""
        seen = {}
        for a in soup.select('a[href*="/categories/"]'):
            href = a.get("href", "")
            url = _abs(portal_url, href)
            slug = _slug_id(url)
            if not slug or slug in seen:
                continue
            name = a.get_text(" ", strip=True)
            seen[slug] = {"slug": slug, "name": name or slug.replace("-", " ").title(), "url": url}
        return list(seen.values())

    def _article_links(self, portal_url: str, soup: BeautifulSoup) -> List[Dict]:
        """Extract article links (with titles) from a page."""
        seen = {}
        for a in soup.select('a[href*="/articles/"]'):
            href = a.get("href", "")
            url = _abs(portal_url, href)
            slug = _slug_id(url)
            if not slug or slug in seen:
                continue
            title = a.get_text(" ", strip=True)
            seen[slug] = {"slug": slug, "title": title, "url": url}
        return list(seen.values())

    @staticmethod
    def sanitize_article_html(html: str) -> str:
        """Strip dangerous/irrelevant tags while keeping readable article markup."""
        soup = BeautifulSoup(html or "", "html.parser")
        for tag in soup.find_all(["script", "style", "iframe", "form", "input",
                                  "button", "select", "textarea", "noscript"]):
            tag.decompose()
        for tag in soup.find_all(True):
            keep = {"href", "src", "alt", "title", "target", "rel", "colspan", "rowspan"}
            tag.attrs = {k: v for k, v in tag.attrs.items() if k in keep}
            if tag.name == "a":
                tag["target"] = "_blank"
                tag["rel"] = "noopener noreferrer"
        return str(soup)

    def _parse_article(self, portal_url: str, soup: BeautifulSoup, fallback: Dict) -> Dict:
        """Parse a single article page into a storable document."""
        article = soup.find("article") or soup

        h1 = article.find("h1")
        title = h1.get_text(" ", strip=True) if h1 else fallback.get("title") or fallback["slug"]

        prose = article.find("div", class_=lambda c: c and "prose" in c.split())
        body_html = self.sanitize_article_html(str(prose) if prose else "")

        # Breadcrumb: second link is the category ("Home > Category > Article")
        category_slug = ""
        crumbs = [a.get("href", "") for a in article.select('a[href*="/categories/"]')]
        if crumbs:
            category_slug = _slug_id(_abs(portal_url, crumbs[0]))

        text = BeautifulSoup(body_html, "html.parser").get_text(" ", strip=True)
        excerpt = text[:220]

        return {
            "slug": fallback["slug"],
            "title": title,
            "url": fallback["url"],
            "category_slug": category_slug,
            "content_html": body_html,
            "excerpt": excerpt,
        }

    async def sync_portal(self, site_id: str, portal_url: str) -> Dict:
        """
        Full sync of a help center portal for a site.

        Returns a stats dict {categories, articles, errors}.
        """
        portal_url = portal_url.rstrip("/")
        stats = {"categories": 0, "articles": 0, "errors": []}
        now = datetime.utcnow()
        # The trailing portal path segment is usually the locale (…/hc/{slug}/en)
        last_seg = portal_url.rsplit("/", 1)[-1]
        locale = last_seg if re.fullmatch(r"[a-z]{2}(-[a-zA-Z]{2})?", last_seg) else "pt"

        async with aiohttp.ClientSession() as session:
            home = await self._fetch(session, portal_url)
            if not home:
                stats["errors"].append(f"Could not fetch portal: {portal_url}")
                return stats

            categories = self._category_links(portal_url, home)[:MAX_CATEGORIES]

            # Chatwoot portals render a site-wide article nav on every page, so
            # collect the union of article links — each article's real category
            # comes from its own breadcrumb during parsing.
            article_links: Dict[str, Dict] = {}
            for link in self._article_links(portal_url, home):
                article_links.setdefault(link["slug"], link)

            for cat in categories:
                cat_soup = await self._fetch(session, cat["url"])
                if not cat_soup:
                    stats["errors"].append(f"Category fetch failed: {cat['name']}")
                    continue
                h1 = cat_soup.find("h1")
                if h1:
                    cat["name"] = h1.get_text(" ", strip=True) or cat["name"]
                for link in self._article_links(portal_url, cat_soup):
                    article_links.setdefault(link["slug"], link)
                if len(article_links) >= MAX_ARTICLES_PER_CATEGORY * len(categories):
                    break

            cat_counts: Dict[str, int] = {c["slug"]: 0 for c in categories}
            for link in list(article_links.values())[: MAX_ARTICLES_PER_CATEGORY * max(len(categories), 1)]:
                art_soup = await self._fetch(session, link["url"])
                if not art_soup:
                    stats["errors"].append(f"Article fetch failed: {link['title']}")
                    continue
                doc = self._parse_article(portal_url, art_soup, link)
                if doc.get("category_slug") in cat_counts:
                    cat_counts[doc["category_slug"]] += 1
                doc.update({"site_id": site_id, "updated_at": now, "locale": locale})
                await self.db.db.help_articles.update_one(
                    {"site_id": site_id, "slug": doc["slug"]},
                    {"$set": doc},
                    upsert=True,
                )
                stats["articles"] += 1
                await asyncio.sleep(0.15)

            for cat in categories:
                cat_doc = {
                    "site_id": site_id,
                    "locale": locale,
                    "slug": cat["slug"],
                    "name": cat["name"],
                    "source_url": cat["url"],
                    "article_count": cat_counts.get(cat["slug"], 0),
                    "updated_at": now,
                }
                await self.db.db.help_categories.update_one(
                    {"site_id": site_id, "slug": cat["slug"]},
                    {"$set": cat_doc},
                    upsert=True,
                )
                stats["categories"] += 1

            await self.db.db.sites.update_one(
                {"site_id": site_id},
                {"$set": {"help_center.last_synced_at": now,
                          "help_center.last_sync_stats": {
                              "categories": stats["categories"],
                              "articles": stats["articles"],
                              "errors": len(stats["errors"]),
                          }}}
            )

        logger.info(f"Help center sync for site {site_id}: {stats['categories']} categories, "
                    f"{stats['articles']} articles, {len(stats['errors'])} errors")
        return stats


async def get_help_overview(db, site_id: str) -> Dict:
    """Categories with their article summaries for the widget."""
    categories = await db.db.help_categories.find(
        {"site_id": site_id}, {"_id": 0}
    ).sort("name", 1).to_list(500)

    articles = await db.db.help_articles.find(
        {"site_id": site_id},
        {"_id": 0, "slug": 1, "title": 1, "category_slug": 1, "excerpt": 1, "url": 1},
    ).sort("title", 1).to_list(2000)

    return {"categories": categories, "articles": articles}


async def get_help_article(db, site_id: str, slug: str) -> Optional[Dict]:
    return await db.db.help_articles.find_one(
        {"site_id": site_id, "slug": slug}, {"_id": 0}
    )
