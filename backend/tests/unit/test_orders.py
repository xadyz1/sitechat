import pytest

from app.services.orders import extract_order_refs, format_order_context, order_context_addendum


def test_extract_default_pattern():
    assert extract_order_refs("qual o estado da encomenda SP-75115C?") == ["SP-75115C"]
    assert extract_order_refs("e a HP-0042?") == ["HP-0042"]
    assert extract_order_refs("obrigado") == []


def test_extract_custom_pattern():
    refs = extract_order_refs("encomenda #99123 por favor", r"#\d{4,}")
    assert refs == ["#99123"]


def test_extract_dedupes_and_caps():
    refs = extract_order_refs("SP-1A2B3 SP-1A2B3 XX-99999 YY-88888")
    assert refs == ["SP-1A2B3", "XX-99999"]


def test_format_full_payload():
    payload = {
        "found": True,
        "order": {"ref": "SP-75115C", "status": "cancelled", "total": "117.75",
                  "currency": "EUR", "created_at": "2026-10-23 06:22:14"},
        "items": [{"name": "Satisfyer Orca", "quantity": 2}, {"name": "Pjur Original", "quantity": 1}],
        "events": [{"status": "cancelled"}],
    }
    ctx = format_order_context("SP-75115C", payload)
    assert "cancelled" in ctx
    assert "117.75" in ctx
    assert "Satisfyer Orca x2" in ctx


def test_format_not_found_and_fallback():
    assert "not found" in format_order_context("SP-X9999", {"found": False})
    ctx = format_order_context("SP-X9999", {"weird": {"shape": 1}})
    assert ctx.startswith("Order SP-X9999 data:")


@pytest.mark.asyncio
async def test_addendum_disabled_and_no_ref():
    assert await order_context_addendum("onde está SP-75115C", {}) == ""
    assert await order_context_addendum("ola", {"order_lookup_enabled": True,
                                              "order_lookup_url": "https://x/t?ref={ref}"}) == ""
    assert await order_context_addendum("SP-1A2B3", {"order_lookup_enabled": True,
                                                   "order_lookup_url": "https://x/t?no_placeholder"}) == ""
