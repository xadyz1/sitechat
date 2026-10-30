"""E-commerce product detection and chat product-card matching.

Detection runs on every crawled page (schema.org Product JSON-LD, then
Open Graph product tags). Matching compares product names against the
generated answer so the widget can render product cards for mentions.
"""
import json
import re
import unicodedata
from typing import Dict, List, Optional
from urllib.parse import parse_qs, quote, urljoin, urlparse

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


def detect_platform(url: str, html: str) -> Optional[str]:
    """Best-effort shop platform detection for add-to-cart URL building."""
    soup = BeautifulSoup(html, "html.parser")
    gen = soup.find("meta", attrs={"name": re.compile("generator", re.I)})
    g = (gen.get("content") or "").lower() if gen else ""
    head = (html or "")[:300000].lower()
    if "woocommerce" in g or "woocommerce" in head or "add_to_cart_button" in head:
        return "woocommerce"
    if "shopify" in g or "cdn.shopify.com" in head or "shopify.section" in head:
        return "shopify"
    return None


PID_PARAMS = {"variant", "variant_id", "id", "prod_id", "product_id", "prodid", "sku"}


def _pid_from_url(url: str) -> Optional[str]:
    """Product/variant id carried in a URL query param (e.g. Shopify ?variant=)."""
    try:
        q = parse_qs(urlparse(url or "").query)
        for k, vals in q.items():
            if k.lower() in PID_PARAMS and vals and vals[0]:
                return str(vals[0])
    except Exception:
        pass
    return None


def _product_id(soup, url: str) -> Optional[str]:
    """WooCommerce / Shopify product (variant) IDs when present in the markup."""
    btn = soup.find(attrs={"data-product_id": True})
    if btn and btn.get("data-product_id"):
        return str(btn["data-product_id"])
    inp = soup.find("input", attrs={"name": "add-to-cart"})
    if inp and inp.get("value"):
        return str(inp["value"])
    form = soup.find("form", action=re.compile(r"/cart/add", re.I))
    if form:
        vid = form.find("input", attrs={"name": "id"})
        if vid and vid.get("value"):
            return str(vid["value"])
    meta = soup.find("meta", property="product:retailer_item_id")
    if meta and meta.get("content"):
        return str(meta["content"])
    body = soup.find("body", class_=re.compile(r"postid-\d+"))
    if body:
        m = re.search(r"postid-(\d+)", " ".join(body.get("class") or []))
        if m:
            return m.group(1)
    # Custom shops: explicit current-variant globals (e.g. `var PDP_VARIANT = 9;`)
    for script in soup.find_all("script"):
        m = re.search(r"\bPDP_VARIANT\s*=\s*['\"]?(\w{1,32})", script.string or script.get_text() or "")
        if m:
            return m.group(1)
    # Variant selectors carrying per-variant ids (checked option wins)
    inp = (soup.select_one("input[name='variant_id'][checked][value], #pdp-variants input[checked][value]")
           or soup.select_one("input[name='variant_id'][value], input[name='variantId'][value], "
                              "input[name='vid'][value], input[name='variant'][value], "
                              "#pdp-variants input[value]"))
    if inp and (inp.get("value") or "").strip():
        return str(inp["value"]).strip()
    el = soup.select_one("[data-variant-id], [data-vid]")
    if el:
        v = (el.get("data-variant-id") or el.get("data-vid") or "").strip()
        if v:
            return v
    return _pid_from_url(url)


def extract_products(url: str, html: str) -> List[Dict]:
    """Return product dicts found on a page: name, url, image, price, currency, description."""
    soup = BeautifulSoup(html, "html.parser")
    platform = detect_platform(url, html)
    pid = _product_id(soup, url)
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
            node_pid = n.get("productID") or n.get("sku") or _pid_from_url(n.get("url") or "") or pid
            offer = _first(n.get("offers"))
            if not node_pid and isinstance(offer, dict):
                node_pid = offer.get("sku")
            found.append({
                "name": name[:160],
                "url": urljoin(url, n.get("url") or url),
                "image": urljoin(url, image) if image else None,
                "price": str(price) if price is not None else None,
                "currency": currency,
                "description": (n.get("description") or "")[:300],
                "source": "jsonld",
                "product_id": str(node_pid) if node_pid else None,
                "platform": platform,
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
                    "product_id": pid,
                    "platform": platform,
                })

    if not found:
        found.extend(_heuristic_products(url, soup, pid, platform))

    # Dedupe by URL+name
    seen, out = set(), []
    for p in found:
        key = (p["url"], p["name"].lower())
        if key not in seen and p.get("image"):
            seen.add(key)
            out.append(p)
    return out


PRODUCT_PATH_RE = re.compile(
    r"/(produtos?|products?|produits?|prodott[oi]|artikel|items?|p|shop|loja|artigos?)/[^/?#]+", re.I)
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


def _heuristic_products(url: str, soup: BeautifulSoup, pid: Optional[str] = None,
                        platform: Optional[str] = None) -> List[Dict]:
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
                "product_id": pid, "platform": platform,
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
            "product_id": _pid_from_url(href), "platform": platform,
        })
    return out


def site_domain(url: str) -> str:
    url = (url or "").strip()
    if url and "://" not in url:
        url = "https://" + url
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


_HYPHENS = dict.fromkeys(map(ord, "‐‑‒–—−﹘﹣－︲"), "-")


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").translate(_HYPHENS))
    s = re.sub(r"[^\x00-\x7f]", " ", s)
    s = re.sub(r"[\"'“”‘’]", "", s.lower())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


GENERIC_WORDS = {"t", "shirt", "tshirt", "t shirt", "tee", "top", "hat", "cap", "unisex", "men", "mens", "women",
                 "womens", "homem", "mulher", "senhora", "the", "a", "o", "de", "com", "and", "e", "preto", "preta",
                 "branco", "branca", "black", "white", "size", "pack", "new", "novo", "nova", "edition", "classic"}


def catalog_prompt(products: List[Dict], limit: int = 40, cart_enabled: bool = False) -> str:
    """System-prompt addendum listing exact product names so the model uses them verbatim."""
    if not products:
        return ""
    lines = []
    for p in products[:limit]:
        price = f" — {p['price']} {p.get('currency') or ''}".rstrip() if p.get("price") else ""
        lines.append(f"- {p['name']}{price}")
    prompt = ("\n\nShop catalog (when you mention or recommend a product, use its EXACT name as written here "
              "so it can be shown as a product card):\n" + "\n".join(lines))
    if cart_enabled:
        prompt += (
            "\n\nCart actions: when the shopper explicitly asks you to add one or more products to their "
            "cart, confirm briefly in their language and append ONE machine-readable line at the very end "
            "of your reply, using the EXACT catalog names:\n"
            '[[cart:{"items":[{"name":"Exact Product Name","qty":1}]}]]\n'
            "Emit it only when the user clearly wants the item(s) added — never for questions, "
            "comparisons or recommendations."
        )
    return prompt


def cart_actions_enabled(behavior: Dict) -> bool:
    """Whether the shop can actually accept add-to-cart links (template or known platform)."""
    behavior = behavior or {}
    if (behavior.get("shop_platform") or "auto") == "none":
        return False
    if (behavior.get("cart_url_template") or "").strip():
        return True
    return (behavior.get("shop_platform") or "auto") in ("woocommerce", "shopify")


CART_ACTION_RE = re.compile(r"\[\[\s*cart\s*:\s*(\{.*?\})\s*\]\]", re.I | re.S)

# Optional product-card hint tags site owners put in custom prompts, e.g.
# "[prod:Exact Product Name]" on its own line → the card is injected and the
# tag never reaches the visitor.
PRODUCT_TAG_RE = re.compile(r"\[\s*(?:prod|product)\s*:\s*([^\]\n]+)\]", re.I)


def extract_product_tags(answer: str) -> List[str]:
    """Catalog names the agent embedded as ``[prod:name]`` card hints."""
    if not answer:
        return []
    return [m.strip()[:160] for m in PRODUCT_TAG_RE.findall(answer) if m.strip()]


def parse_cart_actions(answer: str) -> tuple:
    """Split ``[[cart:{...}]]`` markers out of an LLM answer.

    Returns ``(clean_answer, specs)`` where specs is ``[{"name": str, "qty": int}]``.
    Malformed markers are removed too so they never leak to the visitor.
    """
    specs: List[Dict] = []
    if not answer:
        return answer or "", specs

    def _collect(match) -> str:
        try:
            data = json.loads(match.group(1))
        except Exception:
            return " "
        items = data.get("items") if isinstance(data, dict) else None
        for item in items or []:
            if not isinstance(item, dict):
                continue
            name = (item.get("name") or item.get("product") or "").strip()
            if not name:
                continue
            try:
                qty = int(item.get("qty") or item.get("quantity") or 1)
            except (TypeError, ValueError):
                qty = 1
            specs.append({"name": name[:160], "qty": max(1, min(10, qty))})
        return " "

    clean = CART_ACTION_RE.sub(_collect, answer)
    # Drop malformed/unterminated leftovers so they never reach the visitor.
    clean = re.sub(r"\[\[\s*cart\s*:[^\]]*\]?", " ", clean)
    # [prod:name] card hints are resolved server-side and never shown.
    clean = PRODUCT_TAG_RE.sub(" ", clean)
    clean = re.sub(r"[ \t]+(\n|$)", r"\1", clean).strip()
    return clean, specs


def resolve_cart_actions(specs: List[Dict], products: List[Dict], limit: int = 6) -> List[Dict]:
    """Attach each agent cart spec to a catalog product (exact → fuzzy name match).

    Returns [{"product": <catalog dict>, "qty": int}]; unresolved specs are dropped.
    """
    resolved = []
    for spec in specs[:limit]:
        target = _norm(spec.get("name") or "")
        if not target:
            continue
        product = next((p for p in products if _norm(p.get("name") or "") == target), None)
        if product is None:
            cands = [
                p for p in products
                if (n := _norm(p.get("name") or "")) and (n in target or (len(target) >= 10 and target in n))
            ]
            product = max(cands, key=lambda p: len(_norm(p.get("name") or "")), default=None)
        if product is None:
            hits = match_products(spec.get("name") or "", products, limit=1)
            product = hits[0] if hits else None
        if product is None:
            continue
        resolved.append({"product": product, "qty": spec.get("qty") or 1})
    return resolved


def match_products(answer: str, products: List[Dict], limit: int = 4) -> List[Dict]:
    """Products whose name appears (normalised) in the answer, best/longest first."""
    text = _norm(answer)
    if not text or not products:
        return []
    hits = []
    padded = f" {text} "
    for p in products:
        name = _norm(p.get("name", ""))
        if len(name) < 3:
            continue
        if f" {name} " in padded:
            hits.append((len(name), True, p))
            continue
        # Partial: the model often drops generic words ("t-shirt", "unisex") or
        # suffixes ("- Black"). Accept the longest distinctive contiguous n-gram
        # (>= 2 words, >= 10 chars, not only generic words) found in the answer.
        words = [w for w in name.split() if w]
        best = 0
        for size in range(len(words), 1, -1):
            for i in range(0, len(words) - size + 1):
                gram = words[i:i + size]
                if all(g in GENERIC_WORDS for g in gram):
                    continue
                phrase = " ".join(gram)
                if len(phrase) >= 10 and f" {phrase} " in padded:
                    best = len(phrase)
                    break
            if best:
                break
        if best:
            hits.append((best, False, p))
    # Longest match first; exact beats partial; for equal partial matches the
    # product whose name is closest to the phrase wins ("Oversized Faded" ->
    # "Oversized faded t-shirt", not "Brand Oversized faded t-shirt").
    hits.sort(key=lambda h: (-h[0], not h[1], len(_norm(h[2].get("name", "")))))
    out, seen, taken_exact, taken_partial_scores = [], set(), [], {}
    for score, exact, p in hits:
        key = p.get("url") or p.get("name") or ""
        if key in seen:
            continue
        name = _norm(p.get("name", ""))
        # "Oversized tee" shouldn't fire just because "Brand Oversized tee" was
        # mentioned in full: require an occurrence not covered by that exact match.
        if any(name in longer for longer in taken_exact):
            remaining = text
            for longer in taken_exact:
                remaining = remaining.replace(longer, " ")
            if name not in remaining:
                continue
        # One partial phrase shouldn't fan out to every variant sharing it
        if not exact and score in taken_partial_scores:
            continue
        if exact:
            taken_exact.append(name)
        else:
            taken_partial_scores[score] = name
        seen.add(key)
        out.append({k: p.get(k) for k in ("name", "url", "image", "price", "currency", "product_id", "platform")})
        if len(out) >= limit:
            break
    return out


def enrich_matches(matched: List[Dict], catalog: List[Dict]) -> List[Dict]:
    """Fill missing fields on matched cards from same-name sibling docs.

    A product can be catalogued twice (e.g. canonical URL from JSON-LD and a
    `?lang=` listing card). If the matched doc lacks product_id/platform/etc.
    the sibling often carries them — merge instead of losing the cart button.
    """
    by_name: Dict[str, List[Dict]] = {}
    for p in catalog:
        key = _norm(p.get("name") or "")
        if key:
            by_name.setdefault(key, []).append(p)
    out = []
    for m in matched:
        merged = dict(m)
        for sib in by_name.get(_norm(m.get("name") or ""), []):
            if sib is m:
                continue
            for k in ("product_id", "variant_id", "platform", "image", "price", "currency", "url"):
                if not merged.get(k) and sib.get(k):
                    merged[k] = sib[k]
        out.append(merged)
    return out


CART_TEMPLATES = {
    "woocommerce": "{base}/?add-to-cart={id}",
    "shopify": "{base}/cart/{id}:1",
}


def build_cart_url(behavior: Dict, product: Dict, site_url: str, qty: int = 1) -> Optional[str]:
    """Add-to-cart deep link for a matched product, or None when not possible.

    behavior.shop_platform: auto | woocommerce | shopify | custom | none
    custom uses behavior.cart_url_template with {id} {qty} {url} {eurl} {base} {name}
    placeholders — {url} is the raw product URL, {eurl} the URL-encoded value
    (for templates that carry it as a query param). Templates that hardcode
    ``qty=1`` get it patched to the requested quantity.
    """
    platform = (behavior.get("shop_platform") or "auto")
    if platform == "none":
        return None
    if platform == "custom":
        tpl = (behavior.get("cart_url_template") or "").strip()
    else:
        plat = product.get("platform") if platform == "auto" else platform
        tpl = CART_TEMPLATES.get(plat or "") or (behavior.get("cart_url_template") or "").strip()
    if not tpl:
        return None
    pid = product.get("product_id") or product.get("variant_id")
    # {id} is required unless the template can fall back on the product URL
    # ({url}/{eurl}) — shops may resolve the variant from the product page.
    if "{id}" in tpl and not pid and "{url}" not in tpl and "{eurl}" not in tpl:
        return None
    qty = max(1, int(qty or 1))
    parsed = urlparse(site_url or "")
    base = f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else ""
    url = (tpl.replace("{id}", quote(str(pid or ""), safe=""))
              .replace("{qty}", str(qty))
              .replace("{eurl}", quote(product.get("url") or "", safe=""))
              .replace("{url}", product.get("url") or "")
              .replace("{base}", base)
              .replace("{name}", quote(str(product.get("name") or ""), safe="")))
    if qty != 1 and "{qty}" not in tpl:
        url = re.sub(r"([?&]qty=)\d+", rf"\g<1>{qty}", url)
    return url
