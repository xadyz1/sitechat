"""
SwiftFinance sync — pushes normalized finance entities (clients,
subscriptions, revenue) to the central SwiftFinance ingest API so all
SwiftApps revenue is reported in one place.

Configured via:
    SWIFTFINANCE_INGEST_URL — e.g. https://finance.swiftapps.cloud/api/ingest
    SWIFTFINANCE_API_TOKEN  — token generated in SwiftFinance > Integrações

Everything here is best-effort: failures are logged, never raised, so
finance sync can never break checkout or admin flows.
"""
import hashlib
import hmac
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import aiohttp
from loguru import logger

from app.config import settings

_PUSH_TIMEOUT = aiohttp.ClientTimeout(total=10)


def _configured() -> bool:
    return bool(settings.SWIFTFINANCE_INGEST_URL and settings.SWIFTFINANCE_API_TOKEN)


async def push_entities(entities: List[Dict[str, Any]]) -> bool:
    """Send entities to the SwiftFinance ingest API (idempotent upsert)."""
    if not entities or not _configured():
        return False
    ok = True
    headers = {
        "Authorization": f"Bearer {settings.SWIFTFINANCE_API_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        async with aiohttp.ClientSession(timeout=_PUSH_TIMEOUT) as session:
            for i in range(0, len(entities), 400):  # ingest caps at 500/batch
                batch = entities[i:i + 400]
                async with session.post(
                    settings.SWIFTFINANCE_INGEST_URL,
                    json={"entities": batch},
                    headers=headers,
                ) as resp:
                    if resp.status != 200:
                        body = (await resp.text())[:200]
                        logger.warning(f"SwiftFinance ingest rejected batch: {resp.status} {body}")
                        ok = False
    except Exception as e:
        logger.warning(f"SwiftFinance ingest failed: {e}")
        return False
    return ok


def _plan_meta(plan_id: str) -> Dict[str, Any]:
    """Look up plan name/price — lazy import avoids a platform.py cycle."""
    try:
        from app.routes.platform import PLAN_DEFINITIONS
        return next((p for p in PLAN_DEFINITIONS if p["id"] == plan_id), {}) or {}
    except Exception:
        return {}


def user_entities(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Map a SiteChat user document to client + subscription entities."""
    uid = str(user.get("_id") or user.get("user_id") or user.get("email") or "")
    if not uid:
        return []
    email = user.get("email") or ""
    plan_id = user.get("plan") or "trial"
    plan = _plan_meta(plan_id)
    return [
        {
            "type": "client",
            "external_id": f"user_{uid}",
            "name": user.get("name") or email,
            "email": email,
        },
        {
            "type": "subscription",
            "external_id": f"plan_{uid}",
            "customer_email": email,
            "plan": plan.get("name") or plan_id,
            "amount": plan.get("monthly_eur"),
            "interval": "month",
            "status": "trial" if plan_id == "trial" else "active",
        },
    ]


async def sync_user_to_finance(user: Dict[str, Any]) -> bool:
    return await push_entities(user_entities(user))


def verify_stripe_signature(payload: bytes, sig_header: str) -> bool:
    """Manual Stripe webhook signature check (t + v1 HMAC-SHA256)."""
    secret = settings.STRIPE_WEBHOOK_SECRET
    if not secret or not sig_header:
        return False
    try:
        parts = dict(item.split("=", 1) for item in sig_header.split(","))
        timestamp = parts["t"]
        if abs(time.time() - int(timestamp)) > 300:
            return False
        signed = timestamp.encode() + b"." + payload
        expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
        return any(
            hmac.compare_digest(expected, sig)
            for key, sig in parts.items()
            if key == "v1"
        )
    except (KeyError, ValueError):
        return False


def _price_id_to_plan(price_id: Optional[str]) -> Optional[str]:
    mapping = {
        settings.STRIPE_PRICE_BASIC_MONTHLY: "Basic",
        settings.STRIPE_PRICE_BASIC_YEARLY: "Basic",
        settings.STRIPE_PRICE_ADVANCED_MONTHLY: "Advanced",
        settings.STRIPE_PRICE_ADVANCED_YEARLY: "Advanced",
    }
    return mapping.get(price_id or "")


async def _stripe_customer_email(customer_id: Optional[str]) -> Optional[str]:
    """Resolve a Stripe customer id to an email (best-effort)."""
    if not customer_id or not settings.STRIPE_SECRET_KEY:
        return None
    try:
        auth = aiohttp.BasicAuth(settings.STRIPE_SECRET_KEY, "")
        async with aiohttp.ClientSession(auth=auth, timeout=_PUSH_TIMEOUT) as session:
            async with session.get(f"https://api.stripe.com/v1/customers/{customer_id}") as r:
                if r.status == 200:
                    return (await r.json()).get("email")
    except Exception:
        pass
    return None


def _ts_to_date(ts: Optional[int]) -> str:
    if not ts:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


async def stripe_event_to_entities(event: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Map a Stripe webhook event to ingest entities ([] = ignored)."""
    etype = event.get("type") or ""
    obj = (event.get("data") or {}).get("object") or {}

    if etype in ("invoice.paid", "invoice.payment_failed", "invoice.voided"):
        status = {
            "invoice.paid": "completed",
            "invoice.payment_failed": "failed",
            "invoice.voided": "void",
        }[etype]
        return [{
            "type": "revenue",
            "external_id": obj.get("id"),
            "amount": (obj.get("amount_paid") or obj.get("amount_due") or 0) / 100,
            "currency": (obj.get("currency") or settings.STRIPE_CURRENCY).upper(),
            "date": _ts_to_date(obj.get("status_transitions", {}).get("paid_at") or obj.get("created")),
            "description": f"Stripe invoice {obj.get('number') or obj.get('id')}",
            "customer_email": obj.get("customer_email") or obj.get("customer_name"),
            "status": status,
        }]

    if etype == "charge.refunded":
        return [{
            "type": "revenue",
            "external_id": obj.get("invoice") or obj.get("id"),
            "status": "refunded",
        }]

    if etype.startswith("customer.subscription."):
        status_map = {
            "customer.subscription.deleted": "cancelled",
        }
        item = ((obj.get("items") or {}).get("data") or [{}])[0]
        price = item.get("price") or {}
        recurring = price.get("recurring") or {}
        return [{
            "type": "subscription",
            "external_id": obj.get("id"),
            "customer_email": await _stripe_customer_email(obj.get("customer")),
            "plan": _price_id_to_plan(price.get("id")) or price.get("nickname") or obj.get("id"),
            "amount": (price.get("unit_amount") or 0) / 100,
            "interval": recurring.get("interval") or "month",
            "status": status_map.get(etype) or obj.get("status") or "active",
        }]

    if etype in ("customer.created", "customer.updated"):
        if not obj.get("email"):
            return []
        return [{
            "type": "client",
            "external_id": f"stripe_{obj.get('id')}",
            "name": obj.get("name") or obj.get("email"),
            "email": obj.get("email"),
        }]

    return []
