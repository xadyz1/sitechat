"""
Custom-domain middleware for help center portals.

When a request's Host matches a site's configured
``config.help_center.custom_domain``, portal-scoped paths are rewritten
internally to ``/hc/{slug}/...`` so the portal is served at the domain root:

    /                      -> /hc/{slug}
    /search, /search.json  -> /hc/{slug}/search[.json]
    /categories/{x}        -> /hc/{slug}/categories/{x}
    /articles/{x}          -> /hc/{slug}/articles/{x}

All other paths (``/api``, ``/widget``, ``/icons``, ``/css`` …) pass through
unchanged so portal pages can still load assets and the embed widget.

The middleware marks the request with ``request.state.hc_custom_domain`` so
the portal renders root-relative links (``/articles/x``) instead of
``/hc/{slug}/articles/x``.

Host -> site resolution is cached briefly to avoid a Mongo lookup per request.
"""
import time
from typing import Dict, Optional, Tuple
from urllib.parse import urlparse

from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.config import settings

_CACHE_TTL = 60.0
# host -> (site slug or None, unix timestamp)
_host_cache: Dict[str, Tuple[Optional[str], float]] = {}

_PORTAL_PREFIXES = ("categories/", "articles/")
_PORTAL_EXACT = {"", "/", "search", "search.json"}
# Paths that must keep working on a custom domain (assets, API, widget, hc itself)
_PASSTHROUGH_PREFIXES = ("api/", "widget/", "icons/", "css/", "js/", "hc/",
                         "manifest.webmanifest", "sw.js", "OneSignalSDKWorker.js")


def _server_hosts() -> set:
    """Hosts that should never be treated as a custom help-center domain."""
    hosts = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}
    for url in (settings.SITE_URL,):
        h = urlparse(url).hostname
        if h:
            hosts.add(h.lower())
    for h in settings.trusted_hosts_list:
        if h != "*":
            hosts.add(h.lower())
    return hosts


def _portal_base(site: dict) -> Optional[str]:
    """Public base identifier (custom slug or site_id) for the portal."""
    hc = (site.get("config") or {}).get("help_center") or {}
    if not hc.get("enabled"):
        return None
    return hc.get("slug") or site.get("site_id")


async def _resolve_custom_host(host: str) -> Optional[str]:
    """Return the portal slug for a Host header value, or None."""
    cached = _host_cache.get(host)
    if cached and cached[1] > time.time():
        return cached[0]

    slug = None
    try:
        from app.database import get_mongodb
        db = await get_mongodb()
        site = await db.db.sites.find_one({"config.help_center.custom_domain": host})
        if site:
            slug = _portal_base(site)
    except Exception as e:
        logger.warning(f"Custom domain lookup failed for {host}: {e}")

    _host_cache[host] = (slug, time.time() + _CACHE_TTL)
    return slug


def _rewrite_path(path: str, slug: str) -> Optional[str]:
    """Map a request path to its /hc/{slug} equivalent, or None to pass through."""
    trimmed = path.lstrip("/")
    if trimmed in _PORTAL_EXACT:
        return f"/hc/{slug}" + (f"/{trimmed}" if trimmed else "")
    for prefix in _PORTAL_PREFIXES:
        if trimmed.startswith(prefix):
            return f"/hc/{slug}/{trimmed}"
    if any(trimmed.startswith(p) for p in _PASSTHROUGH_PREFIXES):
        return None
    # File-looking paths (favicon.ico, assets) pass through to a normal 404;
    # extension-less paths fall back to the portal root so visitors land
    # somewhere sensible.
    if "." in trimmed.rsplit("/", 1)[-1]:
        return None
    return f"/hc/{slug}"


class CustomDomainMiddleware(BaseHTTPMiddleware):
    """Serve help center portals on their configured custom domains."""

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request, call_next):
        host = (request.headers.get("host") or "").split(":")[0].lower()
        if not host or host in _server_hosts() or host.endswith(".localhost"):
            return await call_next(request)

        slug = await _resolve_custom_host(host)
        if not slug:
            return await call_next(request)

        new_path = _rewrite_path(request.url.path, slug)
        if new_path:
            request.scope["path"] = new_path
            query = request.scope.get("query_string", b"")
            request.scope["raw_path"] = new_path.encode() + (
                b"?" + query if query else b""
            )
            request.state.hc_custom_domain = True
            logger.debug(f"Custom domain {host}{request.url.path} -> {new_path}")

        return await call_next(request)
