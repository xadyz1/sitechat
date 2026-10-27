"""Video URL → transcript knowledge extraction.

YouTube videos: captions via the public timedtext API (no dependency).
Other video URLs: falls back to Open Graph metadata (title/description)
plus any declared subtitle <track> we can fetch.
"""
import asyncio
import html
import re
from typing import Optional
from urllib.parse import parse_qs, urlparse

import aiohttp
from bs4 import BeautifulSoup
from loguru import logger

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def extract_youtube_id(url: str) -> Optional[str]:
    try:
        p = urlparse(url)
    except Exception:
        return None
    host = p.netloc.lower()
    if host.endswith("youtu.be"):
        vid = p.path.strip("/").split("/")[0]
        return vid or None
    if "youtube.com" in host or "youtube-nocookie.com" in host:
        if p.path == "/watch":
            return (parse_qs(p.query).get("v") or [None])[0]
        m = re.match(r"^/(embed|shorts|live|v)/([\w-]{6,})", p.path)
        if m:
            return m.group(2)
    return None


async def _fetch(session: aiohttp.ClientSession, url: str) -> tuple:
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=20), allow_redirects=True) as resp:
        return resp.status, await resp.text()


def _parse_vtt(vtt: str) -> str:
    """WebVTT → plain text, dropping timestamps/tags/dupe lines."""
    out, seen = [], set()
    for line in vtt.splitlines():
        line = re.sub(r"<[^>]+>", "", line).strip()
        if not line or line.startswith(("WEBVTT", "Kind:", "Language:")):
            continue
        if re.match(r"^\d{2}:\d{2}", line) or "-->" in line or line.isdigit():
            continue
        if line != seen and line not in seen:
            seen.add(line)
            out.append(html.unescape(line))
    return " ".join(out)


def _meta(soup: BeautifulSoup, *names: str) -> str:
    for name in names:
        tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return html.unescape(tag["content"]).strip()
    return ""


async def fetch_youtube_transcript(video_id: str) -> dict:
    """Pull captions from YouTube's timedtext endpoint (manual > auto > any)."""
    info = {"title": "", "description": "", "author": ""}
    async with aiohttp.ClientSession(headers={"User-Agent": UA}) as session:
        # oEmbed gives title/author without an API key
        try:
            async with session.get(
                f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json",
                timeout=aiohttp.ClientTimeout(total=15),
            ) as r:
                if r.status == 200:
                    data = await r.json()
                    info["title"] = data.get("title", "")
                    info["author"] = data.get("author_name", "")
        except Exception as e:
            logger.warning(f"YouTube oEmbed failed for {video_id}: {e}")

        # Captions via youtube-transcript-api (Innertube; the public
        # timedtext endpoint stopped serving bare baseUrls).
        def _pull() -> tuple:
            from youtube_transcript_api import YouTubeTranscriptApi
            api = YouTubeTranscriptApi()
            tl = api.list(video_id)
            manual = list(tl._manually_created_transcripts.values())
            generated = list(tl._generated_transcripts.values())

            def score(t):
                lang = (t.language_code or "").lower()
                return 1 if lang.startswith(("en", "pt")) else 0

            for t in sorted(manual, key=score, reverse=True) or sorted(generated, key=score, reverse=True):
                try:
                    return t.fetch().to_raw_data(), t.language_code
                except Exception:
                    continue
            if manual:
                # generated fallback when all manual failed
                for t in sorted(generated, key=score, reverse=True):
                    try:
                        return t.fetch().to_raw_data(), t.language_code
                    except Exception:
                        continue
            return [], ""

        try:
            raw, lang = await asyncio.get_event_loop().run_in_executor(None, _pull)
            if raw:
                text, seen = [], set()
                for seg in raw:
                    line = re.sub(r"\s+", " ", html.unescape(seg.get("text", ""))).strip()
                    if line and line not in seen:
                        seen.add(line)
                        text.append(line)
                return {**info, "transcript": " ".join(text), "language": lang}
        except Exception as e:
            logger.warning(f"YouTube transcript fetch failed for {video_id}: {e}")
    return {**info, "transcript": ""}


async def fetch_video_metadata(url: str) -> dict:
    """Generic video page → OG metadata + best-effort text."""
    async with aiohttp.ClientSession(headers={"User-Agent": UA}) as session:
        try:
            status, body = await _fetch(session, url)
        except Exception as e:
            return {"title": "", "text": "", "error": str(e)}
        if status != 200:
            return {"title": "", "text": "", "error": f"HTTP {status}"}
        soup = BeautifulSoup(body, "html.parser")
        title = _meta(soup, "og:title", "twitter:title") or (soup.title.string.strip() if soup.title and soup.title.string else "")
        desc = _meta(soup, "og:description", "twitter:description", "description")
        # Try a declared subtitle track
        track = soup.find("track", attrs={"kind": re.compile("captions|subtitles")})
        text = ""
        if track and track.get("src"):
            src = track["src"]
            if src.startswith("/"):
                p = urlparse(url)
                src = f"{p.scheme}://{p.netloc}{src}"
            try:
                tstatus, vtt = await _fetch(session, src)
                if tstatus == 200:
                    text = _parse_vtt(vtt)
            except Exception:
                pass
        return {"title": title, "text": text or desc}
