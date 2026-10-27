"""Link preview endpoint — OG metadata for URLs shared in chat messages."""
from fastapi import APIRouter, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.services.linkpreview import fetch_link_preview

router = APIRouter(prefix="/api", tags=["Link Preview"])
limiter = Limiter(key_func=get_remote_address)


@router.get("/link-preview")
@limiter.limit("30/minute")
async def link_preview(request: Request, url: str = Query(..., max_length=2000)):
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid URL")
    data = await fetch_link_preview(url)
    if not data:
        raise HTTPException(status_code=404, detail="No preview available")
    return data
