"""E-commerce product detection and chat product-card matching.

Detection runs on every crawled page (schema.org Product JSON-LD, then
Open Graph product tags). Matching compares product names against the
generated answer so the widget can render product cards for mentions.
"""
import json
import re
import unicodedata
from typing import Dict, List, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from loguru import logger


def _first(v):
    if isinstance(v, list):
        return v[0] if v else None
    return v


def _price_from_offer(offer) -> tuple:
    offer = _first(offer) or {}
    if not isinstance(offer, dict):
        return None, None
    price = offer.get("price") or offer.get("lowPrice")
    if price is None and isinstance(offer.get("priceSpecification"), dict):
        price = offer["priceSpecification"].get("price")
    return price, offer.get("priceCurrency")


def _walk_jsonld(node, out: list):
    """Collect Product nodes from nested JSON-LD (incl. @graph / ItemList)."""
    if isinstance(node, list):
        for n in node:
            _walk_jsonld(n, out)
        return
    if not isinstance(node, dict):
        return
    t = node.get("@type")
    types = t if isinstance(t, list) else [t]
    if any(str(x).lower() in ("product", "productgroup") for x in types if x):
        out.append(node)
    for key in ("@graph", "itemListElement", "mainEntity", "hasVariant"):
        if key in node:
            _walk_jsonld(node[key], out)
    if "item" in node and isinstance(node["item"], dict):
        _walk_jsonld(node["item"], out)


def extract_products(url: str, html: str) -> List[Dict]:
    """Return product dicts found on a page: name, url, image, price, currency, description."""
    soup = BeautifulSoup(html, "html.parser")
    found: List[Dict] = []

    for tag in soup.find_all("script", type=re.compile("ld\\+json", re.I)):
        try:
            data = json.loads(tag.string or tag.get_text() or "")
        except Exception:
            continue
        nodes: list = []
        _walk_jsonld(data, nodes)
        for n in nodes:
            name = (n.get("name") or "").strip()
            if not name:
                continue
            price, currency = _price_from_offer(n.get("offers"))
            image = _first(n.get("image"))
            if isinstance(image, dict):
                image = image.get("url") or image.get("contentUrl")
            found.append({
                "name": name[:160],
                "url": urljoin(url, n.get("url") or url),
                "image": urljoin(url, image) if image else None,
                "price": str(price) if price is not None else None,
                "currency": currency,
                "description": (n.get("description") or "")[:300],
                "source": "jsonld",
            })

    if not found:
        og_type = soup.find("meta", property="og:type")
        price_meta = (soup.find("meta", property="product:price:amount")
                      or soup.find("meta", property="og:price:amount"))
        is_product = bool(price_meta) or (og_type and "product" in (og_type.get("content") or "").lower())
        if is_product:
            title = soup.find("meta", property="og:title")
            image = soup.find("meta", property="og:image")
            cur = (soup.find("meta", property="product:price:currency")
                   or soup.find("meta", property="og:price:currency"))
            desc = soup.find("meta", property="og:description")
            name = (title.get("content") if title else None) or (soup.title.string if soup.title else "")
            if name:
                found.append({
                    "name": name.strip()[:160],
                    "url": url,
                    "image": urljoin(url, image["content"]) if image and image.get("content") else None,
                    "price": price_meta.get("content") if price_meta else None,
                    "currency": cur.get("content") if cur else None,
                    "description": (desc.get("content") if desc else "")[:300],
                    "source": "og",
                })

    if not found:
        found.extend(_heuristic_products(url, soup))

    # Dedupe by URL+name
    seen, out = set(), []
    for p in found:
        key = (p["url"], p["name"].lower())
        if key not in seen and p.get("image"):
            seen.add(key)
            out.append(p)
    return out


PRODUCT_PATH_RE = re.compile(r"/(produto|product|products|produtos|item|p|shop|loja|artigo)/[^/?#]+", re.I)
PRICE_RE = re.compile(r"(?:€|EUR|\$|£|USD|GBP|R\$)\s?(\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})?)|(\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2}))\s?(?:€|EUR|\$|£|USD|GBP)", re.I)
LOGO_RE = re.compile(r"logo|icon|sprite|placeholder|avatar|flag|payment|visa|mastercard|paypal", re.I)
CURRENCY_SYMBOLS = {"€": "EUR", "$": "USD", "£": "GBP", "R$": "BRL"}


def _price_in(text: str) -> tuple:
    m = PRICE_RE.search(text or "")
    if not m:
        return None, None
    raw = m.group(1) or m.group(2)
    sym = next((s for s in ("R$", "€", "$", "£") if s in m.group(0)), None)
    code_m = re.search(r"EUR|USD|GBP", m.group(0), re.I)
    cur = CURRENCY_SYMBOLS.get(sym) if sym else (code_m.group(0).upper() if code_m else None)
    # normalise "1.234,56" / "1,234.56" / "41,00" to "1234.56"
    if "," in raw and "." in raw:
        raw = raw.replace(".", "").replace(",", ".") if raw.rfind(",") > raw.rfind(".") else raw.replace(",", "")
    elif "," in raw:
        raw = raw.replace(",", ".") if re.search(r",\d{2}$", raw) else raw.replace(",", "")
    return raw, cur


def _heuristic_products(url: str, soup: BeautifulSoup) -> List[Dict]:
    """Shops without structured data: (a) a product detail page — h1 + price +
    a large non-logo image; (b) listing pages — anchors to product-like paths
    wrapping an <img alt=...>."""
    out: List[Dict] = []
    path = urlparse(url).path or "/"

    # (a) Product detail page
    if PRODUCT_PATH_RE.search(path):
        h1 = soup.find("h1")
        name = h1.get_text(strip=True) if h1 else ""
        body_text = soup.get_text(" ", strip=True)
        price, cur = _price_in(body_text[:20000])
        image = None
        og = soup.find("meta", property="og:image")
        if og and og.get("content") and not LOGO_RE.search(og["content"]):
            image = og["content"]
        if not image:
            for img in soup.find_all("img"):
                src = img.get("src") or img.get("data-src") or ""
                if not src or src.startswith("data:") or LOGO_RE.search(src):
                    continue
                alt = (img.get("alt") or "").strip()
                if name and alt and _norm(alt) == _norm(name):
                    image = src
                    break
                if image is None and ("cdn" in src or re.search(r"\.(jpe?g|png|webp)", src, re.I)):
                    image = src
        if name and image:
            out.append({
                "name": name[:160], "url": url, "image": urljoin(url, image),
                "price": price, "currency": cur, "description": "", "source": "heuristic",
            })

    # (b) Listing cards
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not PRODUCT_PATH_RE.search(urlparse(href).path or ""):
            continue
        img = a.find("img")
        if not img:
            continue
        src = img.get("src") or img.get("data-src") or ""
        if not src or src.startswith("data:") or LOGO_RE.search(src):
            continue
        name = (img.get("alt") or "").strip()
        container = a.parent
        if not name and container:
            h = container.find(["h2", "h3", "h4"])
            name = h.get_text(strip=True) if h else ""
        if not name or len(name) < 3:
            continue
        price, cur = (None, None)
        for _ in range(3):
            if container is None:
                break
            price, cur = _price_in(container.get_text(" ", strip=True)[:600])
            if price:
                break
            container = container.parent
        out.append({
            "name": name[:160], "url": urljoin(url, href), "image": urljoin(url, src),
            "price": price, "currency": cur, "description": "", "source": "heuristic",
        })
    return out


def site_domain(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[\"'“”‘’]", "", s.lower())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def match_products(answer: str, products: List[Dict], limit: int = 4) -> List[Dict]:
    """Products whose name appears (normalised) in the answer, best/longest first."""
    text = _norm(answer)
    if not text or not products:
        return []
    hits = []
    for p in products:
        name = _norm(p.get("name", ""))
        if len(name) < 3:
            continue
        if name in text:
            hits.append((len(name), p))
            continue
        # Partial: product names often carry suffixes ("- Black", "| Shop");
        # accept when a distinctive prefix (>= 3 words, >= 12 chars) matches.
        words = name.split()
        if len(words) >= 3:
            prefix = " ".join(words[:4])
            if len(prefix) >= 12 and prefix in text:
                hits.append((len(prefix), p))
    hits.sort(key=lambda h: h[0], reverse=True)
    out, seen, taken_names = [], set(), []
    for _, p in hits:
        if p["url"] in seen:
            continue
        name = _norm(p.get("name", ""))
        # "Oversized tee" shouldn't fire just because "Brand Oversized tee" did:
        # require an occurrence not already covered by a longer matched name.
        if any(name in longer for longer in taken_names):
            remaining = text
            for longer in taken_names:
                remaining = remaining.replace(longer, " ")
            if name not in remaining:
                continue
        taken_names.append(name)
        seen.add(p["url"])
        out.append({k: p.get(k) for k in ("name", "url", "image", "price", "currency")})
        if len(out) >= limit:
            break
    return out
