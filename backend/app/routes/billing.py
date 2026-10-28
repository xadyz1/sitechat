"""
Billing webhooks — receives Stripe events, verifies the signature and
forwards normalized revenue/subscription/client entities to SwiftFinance.

Configure in the Stripe dashboard:
    Endpoint URL: https://agent.swiftapps.cloud/api/webhooks/stripe
    Events: invoice.paid, invoice.payment_failed, invoice.voided,
            charge.refunded, customer.subscription.*, customer.created,
            customer.updated
"""
import json

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from app.config import settings
from app.services.finance_sync import push_entities, stripe_event_to_entities, verify_stripe_signature

router = APIRouter(prefix="/api", tags=["billing"])


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    """Stripe event receiver — public endpoint, signature is the auth."""
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Stripe webhook not configured")
    if not verify_stripe_signature(payload, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    try:
        event = json.loads(payload)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    entities = await stripe_event_to_entities(event)
    if entities:
        pushed = await push_entities(entities)
        logger.info(
            f"Stripe event {event.get('type')} -> {len(entities)} entities "
            f"({'pushed' if pushed else 'push failed/skipped'})"
        )
    return {"received": True}
