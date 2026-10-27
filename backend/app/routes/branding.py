"""Brand detection endpoint — preview a website's branding before creating a site."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from slowapi import Limiter
from loguru import logger

from app.routes.auth import require_auth
from app.services.branding import fetch_brand_info
from app.core.security import get_client_ip
from fastapi import Request

limiter = Limiter(key_func=get_client_ip)

router = APIRouter(tags=["branding"])


class BrandInfoRequest(BaseModel):
    url: str = Field(..., description="Website URL to analyse")


@router.post("/api/brand-info")
@limiter.limit("10/minute")
async def get_brand_info(request: Request, body: BrandInfoRequest, user: dict = Depends(require_auth)):
    """Fetch a website and extract brand colours, icon, language and suggested questions."""
    try:
        return await fetch_brand_info(body.url.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.warning(f"Brand detection failed for {body.url}: {e}")
        raise HTTPException(status_code=502, detail="Could not fetch that website. Check the URL and try again.")
