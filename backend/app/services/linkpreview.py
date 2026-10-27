"""Open Graph link-preview fetcher for chat message URL cards.

Public-facing (the widget calls it), so it must be safe against SSRF:
private/loopback/link-local IPs are refused after DNS resolution.
"""
import asyncio
import html
import ipaddress
import socket
import time
from typing import Optional
from urllib.parse import urlparse

import aiohttp
from bs4 import BeautifulSoup
from loguru import logger

UA = "Mozilla/5.0 (compatible; SwiftChatBot/1.0; +https://agent.swiftapps.cloud)"
_CACHE: dict = {}
_CACHE_TTL = 3600
_CACHE_MAX = 500


def _is_public_url(url: str) -> bool:
    """Reject non-http(s) schemes and hosts resolving to private addresses."""
    try:
        host = urlparse(url).hostname
    except Exception:
        return False
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return True


def _meta(soup: BeautifulSoup, *names: str) -> str:
    for name in names:
        tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return html.unescape(tag["content"]).strip()
    return ""


async def fetch_link_preview(url: str) -> Optional[dict]:
    cached = _CACHE.get(url)
    if cached and time.time() - cached["ts"] < _CACHE_TTL:
        return cached["data"]
    if not _is_public_url(url):
        return None
    try:
        async with aiohttp.ClientSession(headers={"User-Agent": UA}) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10),
                                   allow_redirects=True, max_redirects=3) as resp:
                if resp.status != 200 or "html" not in (resp.headers.get("Content-Type") or ""):
                    return None
                body = await resp.text(errors="replace")
    except Exception as e:
        logger.debug(f"link preview fetch failed for {url}: {e}")
        return None

    soup = BeautifulSoup(body[:200_000], "html.parser")
    title = _meta(soup, "og:title", "twitter:title")
    if not title and soup.title and soup.title.string:
        title = soup.title.string.strip()
    image = _meta(soup, "og:image", "twitter:image")
    if image and image.startswith("/"):
        p = urlparse(url)
        image = f"{p.scheme}://{p.netloc}{image}"
    data = {
        "url": url,
        "title": title[:200],
        "description": _meta(soup, "og:description", "twitter:description", "description")[:400],
        "image": image,
        "site_name": _meta(soup, "og:site_name") or urlparse(url).hostname or "",
    }
    if not data["title"]:
        return None
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.clear()
    _CACHE[url] = {"ts": time.time(), "data": data}
    return data
