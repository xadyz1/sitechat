"""
Platform settings API routes for white-labeling and global configuration,
plus platform-owner (master admin) endpoints for users, plans and finance.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from loguru import logger
from pydantic import BaseModel

from app.config import settings
from app.database import get_mongodb
from app.routes.auth import require_admin, require_auth
from app.models.schemas import PlatformWhiteLabelConfig, PlatformWhiteLabelUpdate
from app.services.finance_sync import push_entities, sync_user_to_finance, user_entities

router = APIRouter(prefix="/api/platform", tags=["platform"])


@router.get("/whitelabel", response_model=PlatformWhiteLabelConfig)
async def get_whitelabel_config():
    """
    Get platform white-label configuration.
    This endpoint is public so the dashboard can load branding settings.
    """
    mongodb = await get_mongodb()
    config = await mongodb.get_platform_whitelabel()
    
    if not config:
        return PlatformWhiteLabelConfig()
    
    return PlatformWhiteLabelConfig(**config)


@router.put("/whitelabel", response_model=PlatformWhiteLabelConfig)
async def update_whitelabel_config(
    update: PlatformWhiteLabelUpdate,
    user: dict = Depends(require_admin)
):
    """
    Update platform white-label configuration.
    Only admins can update platform settings.
    """
    mongodb = await get_mongodb()
    
    current_config = await mongodb.get_platform_whitelabel() or {}
    
    update_data = update.model_dump(exclude_unset=True)
    current_config.update(update_data)
    
    updated = await mongodb.update_platform_whitelabel(current_config)
    
    logger.info(f"Platform white-label config updated by user {user.get('email')}")
    
    return PlatformWhiteLabelConfig(**updated) if updated else PlatformWhiteLabelConfig()


@router.post("/whitelabel/reset", response_model=PlatformWhiteLabelConfig)
async def reset_whitelabel_config(user: dict = Depends(require_admin)):
    """
    Reset platform white-label configuration to defaults.
    Only admins can reset platform settings.
    """
    mongodb = await get_mongodb()
    
    default_config = PlatformWhiteLabelConfig().model_dump()
    
    await mongodb.update_platform_whitelabel(default_config)
    
    logger.info(f"Platform white-label config reset by user {user.get('email')}")
    
    return PlatformWhiteLabelConfig()


# ==================== Master admin (platform owner) ====================
# The account configured via MASTER_ADMIN_EMAIL gets cross-platform
# access: users management, subscription plans and finance.


def _is_master(user: dict) -> bool:
    master = (settings.MASTER_ADMIN_EMAIL or "").strip().lower()
    return bool(master) and (user.get("email") or "").lower() == master


async def require_master(user: dict = Depends(require_auth)) -> dict:
    if not _is_master(user):
        raise HTTPException(status_code=403, detail="Platform owner access required")
    return user


# --------------------------- Plans ---------------------------

PLAN_DEFINITIONS = [
    {
        "id": "trial",
        "name": "Trial",
        "monthly_eur": 0,
        "yearly_eur": 0,
        "highlights": "Evaluation access — full features while you test.",
    },
    {
        "id": "basic",
        "name": "Basic",
        "monthly_eur": 10,
        "yearly_eur": 100,
        "highlights": "Standard widget, automatic site crawler, email lead capture, standard AI engine, core analytics.",
        "stripe_price_monthly": "STRIPE_PRICE_BASIC_MONTHLY",
        "stripe_price_yearly": "STRIPE_PRICE_BASIC_YEARLY",
    },
    {
        "id": "advanced",
        "name": "Advanced",
        "monthly_eur": 25,
        "yearly_eur": 250,
        "highlights": "White-Label, unlimited chats and pages, human handoff, priority support, custom domain.",
        "stripe_price_monthly": "STRIPE_PRICE_ADVANCED_MONTHLY",
        "stripe_price_yearly": "STRIPE_PRICE_ADVANCED_YEARLY",
    },
]


@router.get("/plans")
async def list_plans(user: dict = Depends(require_master)):
    """Plan catalogue with the Stripe price ids from env (null when unset)."""
    plans = []
    for p in PLAN_DEFINITIONS:
        plan = {k: v for k, v in p.items() if not k.startswith("stripe_price")}
        monthly_key = p.get("stripe_price_monthly")
        yearly_key = p.get("stripe_price_yearly")
        plan["stripe_price_monthly"] = getattr(settings, monthly_key, None) if monthly_key else None
        plan["stripe_price_yearly"] = getattr(settings, yearly_key, None) if yearly_key else None
        plans.append(plan)
    return {"plans": plans, "stripe_configured": bool(settings.STRIPE_SECRET_KEY)}


# --------------------------- Users ---------------------------

@router.get("/users")
async def list_platform_users(user: dict = Depends(require_master)):
    """All accounts with role, plan and usage stats."""
    db = await get_mongodb()
    users = await db.get_all_users()
    all_sites = await db.list_sites()
    site_counts = {}
    for s in all_sites:
        owner = s.get("user_id")
        if owner:
            site_counts[str(owner)] = site_counts.get(str(owner), 0) + 1
    out = []
    for u in users:
        uid = str(u.get("_id"))
        user_key = u.get("user_id") or uid
        out.append({
            "id": uid,
            "email": u.get("email"),
            "name": u.get("name"),
            "role": u.get("role"),
            "plan": u.get("plan") or "trial",
            "is_master": _is_master(u),
            "is_active": u.get("is_active", True),
            "site_count": site_counts.get(user_key, 0) + site_counts.get(uid, 0),
            "created_at": u.get("created_at").isoformat() if isinstance(u.get("created_at"), datetime) else u.get("created_at"),
        })
    return {"users": out}


class PlanUpdate(BaseModel):
    plan: str


@router.put("/users/{user_id}/plan")
async def set_user_plan(user_id: str, data: PlanUpdate, user: dict = Depends(require_master)):
    """Assign a subscription plan to a user account."""
    valid = {p["id"] for p in PLAN_DEFINITIONS}
    if data.plan not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid plan. Choose from: {sorted(valid)}")
    db = await get_mongodb()
    target = await db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.update_user(user_id, {"plan": data.plan, "plan_updated_at": datetime.now(timezone.utc)})
    # Best-effort: mirror client + subscription into SwiftFinance reports
    updated = await db.get_user_by_id(user_id) or {**target, "plan": data.plan}
    await sync_user_to_finance(updated)
    return {"ok": True, "user_id": user_id, "plan": data.plan}


# --------------------------- Finance ---------------------------

@router.post("/finance/sync")
async def finance_sync_all(user: dict = Depends(require_master)):
    """Backfill: push every user as client + subscription entities to SwiftFinance."""
    db = await get_mongodb()
    users = await db.get_all_users()
    entities = []
    for u in users:
        entities.extend(user_entities(u))
    pushed = await push_entities(entities)
    return {
        "configured": bool(settings.SWIFTFINANCE_INGEST_URL and settings.SWIFTFINANCE_API_TOKEN),
        "pushed": pushed,
        "entities": len(entities),
        "users": len(users),
    }


async def _stripe_summary() -> dict:
    """Live MRR/subscription summary from Stripe when a secret key is configured."""
    if not settings.STRIPE_SECRET_KEY:
        return {"configured": False}
    try:
        import aiohttp

        auth = aiohttp.BasicAuth(settings.STRIPE_SECRET_KEY, "")
        async with aiohttp.ClientSession(auth=auth) as session:
            async def _get(path, params=None):
                async with session.get(f"https://api.stripe.com/v1{path}", params=params or {}) as r:
                    if r.status != 200:
                        return None
                    return await r.json()

            subs = await _get("/subscriptions", {"status": "active", "limit": 100})
            balance = await _get("/balance")
            if subs is None:
                return {"configured": True, "error": "Stripe API request failed"}

            mrr_cents = 0
            for s in subs.get("data", []):
                for item in (s.get("items") or {}).get("data", []):
                    price = item.get("price") or {}
                    amount = price.get("unit_amount") or 0
                    qty = item.get("quantity") or 1
                    interval = (price.get("recurring") or {}).get("interval")
                    monthly = amount if interval == "month" else (amount / 12 if interval == "year" else 0)
                    mrr_cents += int(monthly * qty)

            available = sum(
                b.get("amount", 0) for b in (balance or {}).get("available", [])
            ) if balance else None

            return {
                "configured": True,
                "active_subscriptions": len(subs.get("data", [])),
                "mrr": round(mrr_cents / 100, 2),
                "arr": round(mrr_cents * 12 / 100, 2),
                "balance_available": round(available / 100, 2) if available is not None else None,
                "currency": settings.STRIPE_CURRENCY,
            }
    except Exception as e:
        return {"configured": True, "error": str(e)}


@router.get("/finance")
async def platform_finance(user: dict = Depends(require_master)):
    """Revenue and subscription metrics — live Stripe data when configured."""
    db = await get_mongodb()
    users = await db.get_all_users()
    plan_counts = {}
    for u in users:
        plan = u.get("plan") or "trial"
        plan_counts[plan] = plan_counts.get(plan, 0) + 1

    prices = {p["id"]: p["monthly_eur"] for p in PLAN_DEFINITIONS}
    estimated_mrr = sum(plan_counts.get(pid, 0) * price for pid, price in prices.items())

    stripe = await _stripe_summary()
    return {
        "plan_distribution": plan_counts,
        "estimated_mrr": estimated_mrr,
        "currency": settings.STRIPE_CURRENCY,
        "stripe": stripe,
    }


@router.get("/overview")
async def platform_overview(user: dict = Depends(require_master)):
    """Top-level platform stats for the master dashboard."""
    db = await get_mongodb()
    users = await db.get_all_users()
    try:
        site_count = await db.db.sites.count_documents({})
        conv_count = await db.db.conversations.count_documents({})
    except Exception:
        site_count = conv_count = 0
    return {
        "total_users": len(users),
        "total_sites": site_count,
        "total_conversations": conv_count,
        "stripe_configured": bool(settings.STRIPE_SECRET_KEY),
        "onesignal_configured": bool(settings.ONESIGNAL_APP_ID),
        "smtp_configured": bool(settings.SMTP_HOST),
    }


# --------------------------- Landing page config ---------------------------

class LandingConfigUpdate(BaseModel):
    ad_slot_1: Optional[str] = None
    ad_slot_2: Optional[str] = None
    demo_booking_embed: Optional[str] = None
    demo_site_id: Optional[str] = None


def _landing_response(config: dict) -> dict:
    return {
        "ad_slot_1": config.get("ad_slot_1") or "",
        "ad_slot_2": config.get("ad_slot_2") or "",
        "demo_booking_embed": config.get("demo_booking_embed") or "",
        "demo_site_id": config.get("demo_site_id") or "",
    }


@router.get("/landing-config")
async def get_landing_config():
    """Public — the landing page reads ad slots, demo chat site and booking embed."""
    db = await get_mongodb()
    return _landing_response(await db.get_landing_config() or {})


@router.put("/landing-config")
async def update_landing_config(update: LandingConfigUpdate, user: dict = Depends(require_master)):
    """Master-only — update ad slot snippets, demo chat site and booking embed."""
    db = await get_mongodb()
    config = await db.get_landing_config() or {}
    for key in ("ad_slot_1", "ad_slot_2", "demo_booking_embed", "demo_site_id"):
        val = getattr(update, key)
        if val is not None:
            config[key] = val
    updated = await db.update_landing_config(config)
    logger.info(f"Landing config updated by {user.get('email')}")
    return _landing_response(updated)


# --------------------------- User management ---------------------------

USER_ROLES = {"admin", "user", "agent"}


class UserCreateIn(BaseModel):
    email: str
    name: str
    password: str
    role: str = "user"
    plan: str = "trial"


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    plan: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


@router.post("/users")
async def create_platform_user(data: UserCreateIn, user: dict = Depends(require_master)):
    """Create a user account (any role, initial plan)."""
    from app.services.auth import get_password_hash

    if data.role not in USER_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {data.role}")
    if data.plan not in {p["id"] for p in PLAN_DEFINITIONS}:
        raise HTTPException(status_code=400, detail="Invalid plan")
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    db = await get_mongodb()
    if await db.get_user_by_email(data.email.lower().strip()):
        raise HTTPException(status_code=400, detail="A user with this email already exists")

    doc = {
        "email": data.email.lower().strip(),
        "name": data.name.strip(),
        "password_hash": get_password_hash(data.password),
        "role": data.role,
        "plan": data.plan,
        "is_active": True,
        "must_change_password": True,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    uid = await db.create_user(doc)
    logger.info(f"User {data.email} created by master {user.get('email')}")
    return {"ok": True, "id": uid}


@router.put("/users/{user_id}")
async def update_platform_user(user_id: str, data: UserUpdateIn, user: dict = Depends(require_master)):
    """Edit a user's name, email, role, plan, status or reset password."""
    from app.services.auth import get_password_hash

    db = await get_mongodb()
    target = await db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    updates = {}
    if data.name is not None:
        updates["name"] = data.name.strip()
    if data.email is not None:
        email = data.email.lower().strip()
        existing = await db.get_user_by_email(email)
        if existing and str(existing.get("_id")) != str(target.get("_id")):
            raise HTTPException(status_code=400, detail="Email already in use")
        updates["email"] = email
    if data.role is not None:
        if data.role not in USER_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role: {data.role}")
        if _is_master(target) and data.role != target.get("role"):
            raise HTTPException(status_code=403, detail="Cannot change the master account role")
        updates["role"] = data.role
    if data.plan is not None:
        if data.plan not in {p["id"] for p in PLAN_DEFINITIONS}:
            raise HTTPException(status_code=400, detail="Invalid plan")
        updates["plan"] = data.plan
    if data.is_active is not None:
        if _is_master(target) and not data.is_active:
            raise HTTPException(status_code=403, detail="Cannot suspend the master account")
        updates["is_active"] = data.is_active
    if data.password:
        if len(data.password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
        updates["password_hash"] = get_password_hash(data.password)
        updates["must_change_password"] = True

    if not updates:
        return {"ok": True, "unchanged": True}
    updates["updated_at"] = datetime.now(timezone.utc)
    await db.update_user(user_id, updates)
    logger.info(f"User {user_id} updated by master {user.get('email')}")
    return {"ok": True}


@router.delete("/users/{user_id}")
async def delete_platform_user(user_id: str, mode: str = "transfer", user: dict = Depends(require_master)):
    """Delete a user account.

    mode=transfer (default): their sites and support agents are reassigned to the
    master account. mode=delete: their sites and agents are deleted too.
    """
    if mode not in ("transfer", "delete"):
        raise HTTPException(status_code=400, detail="mode must be 'transfer' or 'delete'")
    db = await get_mongodb()
    target = await db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if _is_master(target):
        raise HTTPException(status_code=403, detail="Cannot delete the master account")

    target_oid = str(target["_id"])
    stats = {}
    if mode == "transfer":
        master_oid = str(user["_id"])
        stats["sites_transferred"] = await db.transfer_sites_to_user(target_oid, master_oid)
        stats["agents_transferred"] = await db.transfer_agents_to_user(target_oid, master_oid)
    else:
        sites = await db.list_sites(user_id=target_oid)
        for s in sites:
            await db.delete_site(s["site_id"])
        stats["sites_deleted"] = len(sites)
        agents = await db.list_users_agents_for_owner(target_oid)
        for a in agents:
            await db.delete_user(str(a["_id"]))
        stats["agents_deleted"] = len(agents)

    await db.delete_user(user_id)
    logger.warning(f"User {target.get('email')} deleted by master {user.get('email')} (mode={mode})")
    return {"ok": True, **stats}
