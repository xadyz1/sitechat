"""
Web crawler service for scraping websites.
"""
import asyncio
import re
from typing import List, Dict, Set, Optional
from urllib.parse import urljoin, urlparse, urlunsplit
import aiohttp
from bs4 import BeautifulSoup
from loguru import logger

from app.config import settings
from app.database import get_mongodb

# Overlay containers to strip from text (age verification, cookie consent)
GATE_RE = re.compile(r"age[-_]?gate|agegate|age[-_]?verif|age[-_]?check|adult[-_]?(gate|warning|modal)|"
                     r"cookie[-_]?(banner|consent|notice|bar)|gdpr", re.I)
# Buttons that confirm an age gate — clicked automatically during JS rendering
GATE_BUTTON_TEXT_RE = re.compile(
    r"^\s*(sim|yes|oui|sí|si|ja|ok|"
    r"(sim|yes),?\s*(tenho|sou|i am|i'm|soy|tengo).{0,12}|"
    r"(tenho|sou|i am|i'm|soy|tengo|ich bin)\s*(mais de|over|más de|über)?\s*18.{0,10}|"
    r"(enter|entrar|entrer|aceitar|accept|acepto|confirm(ar|o)?|continuar|continue|i agree|concordo)"
    r"(\s*(site|website|a|al|le|now|agora))?)\s*[+!.]*\s*$", re.I)
GATE_BUTTON_18_RE = re.compile(r"18\s*\+?|\+\s*18|maior|adult|over 18|years", re.I)


class CrawlerService:
    """Service for crawling websites and extracting content."""
    
    def __init__(self):
        self.visited_urls: Set[str] = set()
        self.pages: List[Dict] = []
        self.errors: List[str] = []
        self.job_id: Optional[str] = None
        self.thin_pages: int = 0  # fetched pages that yielded too little text (JS shells)
        self.rendered_pages: int = 0  # pages recovered via headless browser
        self._pw = None
        self._browser = None
        self._context = None
    
    @staticmethod
    def _alt_host_url(url: str) -> Optional[str]:
        """The same URL on the alternate host (www.foo ↔ foo) for retry."""
        p = urlparse(url or "")
        if not p.netloc:
            return None
        alt = p.netloc[4:] if p.netloc.startswith("www.") else "www." + p.netloc
        return urlunsplit((p.scheme, alt, p.path, p.query, p.fragment))

    async def crawl(
        self,
        start_url: str,
        max_pages: int = None,
        include_patterns: List[str] = None,
        exclude_patterns: List[str] = None,
        job_id: str = None,
        _alt_retried: bool = False
    ) -> List[Dict]:
        """
        Crawl a website starting from the given URL.
        
        Args:
            start_url: The starting URL to crawl
            max_pages: Maximum number of pages to crawl
            include_patterns: URL patterns to include (regex)
            exclude_patterns: URL patterns to exclude (regex)
            job_id: Crawl job ID for progress tracking
        
        Returns:
            List of crawled pages with content
        """
        self.visited_urls = set()
        self.pages = []
        self.errors = []
        self.job_id = job_id
        self.thin_pages = 0
        self._seen_lang = None
        
        max_pages = max_pages or settings.MAX_PAGES
        include_patterns = include_patterns or []
        exclude_patterns = exclude_patterns or []
        
        # Compile regex patterns
        include_regex = [re.compile(p) for p in include_patterns] if include_patterns else None
        exclude_regex = [re.compile(p) for p in exclude_patterns] if exclude_patterns else None
        
        # Parse base domain
        parsed_start = urlparse(start_url)
        base_domain = f"{parsed_start.scheme}://{parsed_start.netloc}"
        
        # Queue for BFS crawling
        queue = [start_url]
        
        await self._start_browser()
        try:
            async with aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=30),
                headers={"User-Agent": "SwiftChat-Crawler/1.0"}
            ) as session:
                while queue and len(self.pages) < max_pages:
                    # Get next URL
                    url = queue.pop(0)

                    if url in self.visited_urls:
                        continue

                    # Check patterns
                    if not self._should_crawl(url, include_regex, exclude_regex):
                        continue

                    self.visited_urls.add(url)

                    try:
                        # Fetch page
                        page_data = await self._fetch_page(session, url)

                        if page_data:
                            self.pages.append(page_data)

                            # Extract links and add to queue
                            links = self._extract_links(page_data["html"], base_domain, url)
                            for link in links:
                                if link not in self.visited_urls:
                                    queue.append(link)

                            # Update job progress
                            if self.job_id:
                                mongodb = await get_mongodb()
                                await mongodb.update_crawl_job(
                                    self.job_id,
                                    pages_crawled=len(self.pages)
                                )

                            logger.info(f"Crawled: {url} ({len(self.pages)}/{max_pages})")

                        # Respect crawl delay
                        await asyncio.sleep(settings.CRAWL_DELAY)

                    except Exception as e:
                        error_msg = f"Error crawling {url}: {str(e)}"
                        self.errors.append(error_msg)
                        logger.error(error_msg)
        finally:
            await self._stop_browser()

        logger.info(f"Crawl complete. Total pages: {len(self.pages)} (rendered: {self.rendered_pages}, thin: {self.thin_pages})")

        if not self.pages and not _alt_retried:
            alt = self._alt_host_url(start_url)
            if alt and alt != start_url:
                logger.warning(f"No pages crawled from {start_url} — retrying on {alt}")
                return await self.crawl(
                    alt,
                    max_pages=max_pages,
                    include_patterns=include_patterns,
                    exclude_patterns=exclude_patterns,
                    job_id=job_id,
                    _alt_retried=True,
                )
        return self.pages
    
    async def _fetch_page(
        self,
        session: aiohttp.ClientSession,
        url: str
    ) -> Optional[Dict]:
        """Fetch a single page and extract content. Thin (JS-shell) pages are
        retried through the headless browser when JS rendering is enabled."""
        try:
            async with session.get(url) as response:
                if response.status == 403:
                    logger.warning(f"Access forbidden (403) for {url} - site may be blocking crawlers")
                    self.errors.append(f"Access forbidden: {url}")
                    return None
                elif response.status == 429:
                    logger.warning(f"Rate limited (429) for {url} - site has bot protection")
                    self.errors.append(f"Bot protection/rate limited: {url}")
                    return None
                elif response.status != 200:
                    logger.debug(f"HTTP {response.status} for {url}")
                    return None

                content_type = response.headers.get("content-type", "")
                if "text/html" not in content_type:
                    return None

                html = await response.text()

                page = self._extract_page_data(url, html)
                if page is None and self._browser and len(html) > 1000:
                    page = await self._fetch_page_rendered(url)
                return page

        except Exception as e:
            logger.error(f"Error fetching {url}: {e}")
            return None

    def _extract_page_data(self, url: str, html: str, count_thin: bool = True) -> Optional[Dict]:
        """Extract title + text content from raw HTML; None when the page is too thin."""
        soup = BeautifulSoup(html, "html.parser")

        # Remove unwanted elements
        for element in soup.find_all(["script", "style", "nav", "footer", "header", "aside"]):
            element.decompose()
        # Age-gate / cookie-consent overlays pollute every page with the same text
        for element in soup.find_all(attrs={"id": GATE_RE}) + soup.find_all(attrs={"class": GATE_RE}):
            try:
                element.decompose()
            except Exception:
                pass

        # Extract title
        title = ""
        if soup.title:
            title = soup.title.string or ""
        elif soup.find("h1"):
            title = soup.find("h1").get_text(strip=True)

        # Extract main content
        main_content = soup.find("main") or soup.find("article") or soup.find("body")

        if main_content:
            text = main_content.get_text(separator="\n", strip=True)
            text = re.sub(r'\n{3,}', '\n\n', text)
            text = re.sub(r' {2,}', ' ', text)
        else:
            text = soup.get_text(separator="\n", strip=True)

        # Skip pages with very little content — a substantial HTML shell
        # with almost no text usually means a JS-rendered (SPA) page
        if len(text) < 100:
            if count_thin and len(html) > 1000:
                self.thin_pages += 1
            return None

        try:
            from app.services.products import extract_products
            products = extract_products(url, html)
        except Exception as e:
            logger.debug(f"Product extraction failed for {url}: {e}")
            products = []

        return {
            "url": url,
            "title": title.strip(),
            "content": text,
            "html": html,
            "products": products,
            "metadata": {
                "content_length": len(text),
                "word_count": len(text.split())
            }
        }

    # ── Headless-browser rendering (SPA / JS sites) ──────────────────────

    async def _start_browser(self) -> None:
        """Launch a shared Chromium instance if JS rendering is enabled."""
        if not settings.CRAWLER_JS_RENDER:
            return
        try:
            from playwright.async_api import async_playwright
            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"]
            )
            logger.info("JS rendering enabled (Playwright Chromium)")
        except ImportError:
            logger.warning("CRAWLER_JS_RENDER is on but playwright is not installed — static crawl only")
        except Exception as e:
            logger.warning(f"Could not start headless browser ({e}) — static crawl only")
            self._browser = None
            if self._pw:
                try:
                    await self._pw.stop()
                except Exception:
                    pass
                self._pw = None

    async def _stop_browser(self) -> None:
        try:
            if self._context:
                await self._context.close()
        except Exception:
            pass
        self._context = None
        try:
            if self._browser:
                await self._browser.close()
        except Exception:
            pass
        try:
            if self._pw:
                await self._pw.stop()
        except Exception:
            pass
        self._browser = None
        self._pw = None

    async def _dismiss_gates(self, page) -> bool:
        """Click through age-verification / consent overlays so gated content renders.
        Returns True when a gate button was clicked."""
        clicked = False
        try:
            candidates = await page.query_selector_all(
                "button, a[role=button], input[type=button], input[type=submit], [onclick]")
            for el in candidates[:60]:
                try:
                    text = (await el.inner_text()) if await el.evaluate("e => e.tagName !== 'INPUT'") \
                        else (await el.get_attribute("value") or "")
                except Exception:
                    continue
                text = (text or "").strip()
                if not text or len(text) > 40:
                    continue
                container_hit = await el.evaluate(
                    "(e, re) => !!e.closest('[id*=\"age\" i],[class*=\"age\" i],[id*=\"adult\" i],"
                    "[class*=\"adult\" i],[id*=\"gate\" i],[class*=\"gate\" i],[id*=\"verif\" i],"
                    "[class*=\"verif\" i],[class*=\"modal\" i],[role=\"dialog\"]')", None)
                if GATE_BUTTON_18_RE.search(text) or (container_hit and GATE_BUTTON_TEXT_RE.match(text)):
                    if not await el.is_visible():
                        continue
                    await el.click(timeout=2000)
                    clicked = True
                    logger.info(f"Dismissed gate overlay via button: {text!r}")
                    await page.wait_for_timeout(600)
                    break
        except Exception as e:
            logger.debug(f"Gate dismissal skipped: {e}")
        return clicked

    async def _fetch_page_rendered(self, url: str) -> Optional[Dict]:
        """Render a page in headless Chromium and extract content from the live DOM."""
        page = None
        try:
            if self._context is None:
                # One context per crawl: age-gate acceptance stored in cookies /
                # localStorage / sessionStorage carries over to every later page.
                self._context = await self._browser.new_context(user_agent="SwiftChat-Crawler/1.0")
            page = await self._context.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass  # SPAs may never reach networkidle — extract what we have
            if await self._dismiss_gates(page):
                try:
                    await page.wait_for_load_state("networkidle", timeout=5000)
                except Exception:
                    pass
            html = await page.content()
            data = self._extract_page_data(url, html, count_thin=False)
            if data:
                self.rendered_pages += 1
                logger.info(f"Rendered (JS): {url}")
            return data
        except Exception as e:
            logger.warning(f"JS render failed for {url}: {e}")
            return None
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass
    
    # Query params that only re-order / filter / track — never new content
    NOISE_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid",
                    "sort", "order", "orderby", "dir", "view", "focus", "ref", "src", "page_size", "per_page",
                    "variant", "currency", "country"}
    LANG_PARAMS = {"lang", "language", "locale", "hl", "lng"}

    def _prune_query(self, query: str, start_lang: Optional[str]) -> Optional[str]:
        """Drop tracking/sort params; keep only the crawl's own language variant.
        Returns None when the URL is an alternate-language duplicate."""
        from urllib.parse import parse_qsl, urlencode
        kept = []
        for k, v in parse_qsl(query, keep_blank_values=True):
            kl = k.lower()
            if kl in self.NOISE_PARAMS:
                continue
            if kl in self.LANG_PARAMS:
                if start_lang is None:
                    self._seen_lang = getattr(self, "_seen_lang", None) or v
                    start_lang = self._seen_lang
                if v[:2].lower() != start_lang[:2].lower():
                    return None
            kept.append((k, v))
        return urlencode(kept)

    @staticmethod
    def _norm_host(netloc: str) -> str:
        """Host without www./port so www↔apex links count as same-site."""
        host = (netloc or "").lower().split(":")[0]
        return host[4:] if host.startswith("www.") else host

    def _extract_links(self, html: str, base_domain: str, current_url: str) -> List[str]:
        """Extract links from HTML."""
        from urllib.parse import parse_qs
        soup = BeautifulSoup(html, "html.parser")
        links = []
        base_host = self._norm_host(urlparse(base_domain).netloc)
        start_q = parse_qs(urlparse(current_url).query)
        start_lang = next((start_q[k][0] for k in start_q if k.lower() in self.LANG_PARAMS), None)
        if start_lang is None and soup.html is not None and soup.html.get("lang"):
            start_lang = soup.html.get("lang")  # site's declared language wins over link order

        for anchor in soup.find_all("a", href=True):
            href = anchor["href"]

            # Skip empty, javascript, and anchor links
            if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                continue

            # Make absolute URL
            absolute_url = urljoin(current_url, href)
            parsed = urlparse(absolute_url)

            # Only include links from same domain (www↔apex and http↔https count as same)
            if self._norm_host(parsed.netloc) != base_host:
                continue
            
            # Remove fragments
            clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            if parsed.query:
                query = self._prune_query(parsed.query, start_lang)
                if query is None:
                    continue  # alternate-language duplicate of a page we already have
                if query:
                    clean_url += f"?{query}"
            
            # Skip file downloads
            if any(clean_url.lower().endswith(ext) for ext in [".pdf", ".jpg", ".png", ".gif", ".zip", ".mp4"]):
                continue
            
            links.append(clean_url)
        
        return list(set(links))
    
    def _should_crawl(
        self,
        url: str,
        include_regex: List[re.Pattern] = None,
        exclude_regex: List[re.Pattern] = None
    ) -> bool:
        """Check if URL should be crawled based on patterns."""
        # Check exclude patterns first
        if exclude_regex:
            for pattern in exclude_regex:
                if pattern.search(url):
                    return False
        
        # If include patterns specified, URL must match at least one
        if include_regex:
            return any(pattern.search(url) for pattern in include_regex)
        
        return True
    
    def get_stats(self) -> Dict:
        """Get crawl statistics."""
        return {
            "pages_crawled": len(self.pages),
            "urls_visited": len(self.visited_urls),
            "errors": len(self.errors),
            "error_messages": self.errors[:10],  # First 10 errors
            "thin_pages": self.thin_pages
        }
