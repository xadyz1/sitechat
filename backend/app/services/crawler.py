"""
Web crawler service for scraping websites.
"""
import asyncio
import re
from typing import List, Dict, Set, Optional
from urllib.parse import urljoin, urlparse
import aiohttp
from bs4 import BeautifulSoup
from loguru import logger

from app.config import settings
from app.database import get_mongodb


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
    
    async def crawl(
        self,
        start_url: str,
        max_pages: int = None,
        include_patterns: List[str] = None,
        exclude_patterns: List[str] = None,
        job_id: str = None
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

        return {
            "url": url,
            "title": title.strip(),
            "content": text,
            "html": html,
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

    async def _fetch_page_rendered(self, url: str) -> Optional[Dict]:
        """Render a page in headless Chromium and extract content from the live DOM."""
        page = None
        try:
            page = await self._browser.new_page(user_agent="SwiftChat-Crawler/1.0")
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass  # SPAs may never reach networkidle — extract what we have
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
    
    def _extract_links(self, html: str, base_domain: str, current_url: str) -> List[str]:
        """Extract links from HTML."""
        soup = BeautifulSoup(html, "html.parser")
        links = []
        
        for anchor in soup.find_all("a", href=True):
            href = anchor["href"]
            
            # Skip empty, javascript, and anchor links
            if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                continue
            
            # Make absolute URL
            absolute_url = urljoin(current_url, href)
            parsed = urlparse(absolute_url)
            
            # Only include links from same domain
            if f"{parsed.scheme}://{parsed.netloc}" != base_domain:
                continue
            
            # Remove fragments
            clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            if parsed.query:
                clean_url += f"?{parsed.query}"
            
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
