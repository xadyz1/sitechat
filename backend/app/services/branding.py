"""
Brand detection service — fetches a website's homepage and extracts
branding hints used to pre-configure a new site's widget:
name, language, favicon, brand colours and suggested questions.
"""
import re
from collections import Counter
from typing import Dict, List, Optional
from urllib.parse import urljoin, urlparse

import aiohttp
from bs4 import BeautifulSoup
from loguru import logger

_HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{3}){1,2}\b")
_ICON_RELS = ("apple-touch-icon", "icon", "shortcut icon", "mask-icon")

_QUESTION_TEMPLATES = {
    "en": [
        "What does {name} offer?",
        "How can I contact you?",
        "What are your prices or plans?",
        "Where can I find help or documentation?",
    ],
    "pt": [
        "O que é que a {name} oferece?",
        "Como posso contactar-vos?",
        "Quais são os preços ou planos?",
        "Onde posso encontrar ajuda ou documentação?",
    ],
    "es": [
        "¿Qué ofrece {name}?",
        "¿Cómo puedo contactaros?",
        "¿Cuáles son los precios o planes?",
        "¿Dónde puedo encontrar ayuda o documentación?",
    ],
    "fr": [
        "Que propose {name} ?",
        "Comment puis-je vous contacter ?",
        "Quels sont vos tarifs ou forfaits ?",
        "Où puis-je trouver de l'aide ou de la documentation ?",
    ],
    "de": [
        "Was bietet {name} an?",
        "Wie kann ich Sie kontaktieren?",
        "Was sind Ihre Preise oder Pläne?",
        "Wo finde ich Hilfe oder Dokumentation?",
    ],
}
_QUESTION_ICONS = ["💡", "📬", "💰", "📚"]


def _normalise_hex(value: str) -> Optional[str]:
    value = value.strip().lower()
    if not _HEX_RE.fullmatch(value):
        return None
    if len(value) == 4:
        value = "#" + "".join(c * 2 for c in value[1:])
    return value


def _is_neutral(hex_color: str) -> bool:
    """True for near-white, near-black and low-saturation greys — poor brand picks."""
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    mx, mn = max(r, g, b), min(r, g, b)
    saturation = 0 if mx == 0 else (mx - mn) / mx
    return saturation < 0.18 or mx > 242 or mx < 28


def _pick_colours(soup: BeautifulSoup) -> Dict[str, object]:
    candidates: List[str] = []

    meta = soup.find("meta", attrs={"name": "theme-color"})
    theme_color = _normalise_hex(meta.get("content", "")) if meta else None

    sources = [tag.get_text() for tag in soup.find_all("style")]
    sources += [tag.get("style", "") for tag in soup.find_all(attrs={"style": True})]
    counts = Counter(
        c for src in sources for c in
        (filter(None, (_normalise_hex(m) for m in _HEX_RE.findall(src))))
    )
    for colour, _count in counts.most_common(12):
        if not _is_neutral(colour) and colour != theme_color:
            candidates.append(colour)
        if len(candidates) >= 4:
            break

    palette = ([theme_color] if theme_color else []) + candidates
    return {"primary": palette[0] if palette else None, "palette": palette}


def _pick_icon(soup: BeautifulSoup, base_url: str) -> Optional[str]:
    icons = []
    for link in soup.find_all("link", rel=True):
        rels = link.get("rel")
        rel = " ".join(rels).lower() if isinstance(rels, list) else str(rels).lower()
        href = (link.get("href") or "").strip()
        if not any(r in rel for r in _ICON_RELS) or not href or href.startswith("data:"):
            continue
        sizes = link.get("sizes", "")
        score = 0
        m = re.search(r"(\d+)x\d+", str(sizes))
        if m:
            score = int(m.group(1))
        elif "apple-touch-icon" in rel:
            score = 180  # apple-touch icons are typically high-res
        icons.append((score, urljoin(base_url, href)))
    if icons:
        icons.sort(reverse=True)
        return icons[0][1]
    return urljoin(base_url, "/favicon.ico")


def _suggest_questions(language: str, name: str) -> List[Dict[str, str]]:
    templates = _QUESTION_TEMPLATES.get(language, _QUESTION_TEMPLATES["en"])
    return [
        {"text": t.format(name=name or "us"), "icon": _QUESTION_ICONS[i]}
        for i, t in enumerate(templates)
    ]


async def fetch_brand_info(url: str) -> Dict[str, object]:
    """Fetch a URL and extract branding hints. Raises ValueError on failure."""
    if not re.match(r"^https?://", url or ""):
        raise ValueError("URL must start with http:// or https://")

    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=15),
        headers={"User-Agent": "SwiftChat-BrandDetect/1.0"},
    ) as session:
        async with session.get(url, allow_redirects=True) as resp:
            if resp.status != 200:
                raise ValueError(f"Website returned HTTP {resp.status}")
            html = await resp.text()
            final_url = str(resp.url)

    soup = BeautifulSoup(html, "html.parser")

    name = None
    for attrs in ({"property": "og:site_name"}, {"name": "application-name"}):
        meta = soup.find("meta", attrs=attrs)
        if meta and meta.get("content"):
            name = meta["content"].strip()
            break
    if not name and soup.title and soup.title.string:
        name = re.split(r"\s[|\-–—·]\s", soup.title.string.strip())[0]

    lang = (soup.html.get("lang") or "en").split("-")[0].lower() if soup.html else "en"
    host = urlparse(final_url).netloc

    return {
        "name": name or host,
        "language": lang,
        "favicon": _pick_icon(soup, final_url),
        "colors": _pick_colours(soup),
        "suggested_questions": _suggest_questions(lang, name or host),
    }
