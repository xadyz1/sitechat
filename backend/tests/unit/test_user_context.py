import pytest

from app.services import user_context
from app.services.user_context import user_context_addendum


@pytest.mark.asyncio
async def test_disabled_without_flag_or_url():
    assert await user_context_addendum("tok", {}) == ""
    assert await user_context_addendum("tok", {"user_context_enabled": True}) == ""
    assert await user_context_addendum("tok", {"user_context_enabled": True,
                                               "user_context_url": "https://x/c?no_placeholder"}) == ""


@pytest.mark.asyncio
async def test_no_token_skips_fetch():
    behavior = {"user_context_enabled": True, "user_context_url": "https://x/c?t={token}"}
    assert await user_context_addendum(None, behavior) == ""
    assert await user_context_addendum("   ", behavior) == ""


@pytest.mark.asyncio
async def test_fetch_injects_context_text(monkeypatch):
    captured = {}

    async def fake_fetch(url):
        captured["url"] = url
        return {"context": "Customer Ana — pending mail: 2 — unpaid quotes: €4.00"}

    monkeypatch.setattr(user_context, "_fetch", fake_fetch)
    out = await user_context_addendum("abc.def", {"user_context_enabled": True,
                                                  "user_context_url": "https://x/c?t={token}"})
    assert "abc.def" in captured["url"]
    assert "pending mail: 2" in out
    assert "never invent" in out


@pytest.mark.asyncio
async def test_dict_payload_falls_back_to_json(monkeypatch):
    async def fake_fetch(url):
        return {"pending_mail": 3, "plan": "pro"}

    monkeypatch.setattr(user_context, "_fetch", fake_fetch)
    out = await user_context_addendum("t", {"user_context_enabled": True,
                                            "user_context_url": "https://x/{token}"})
    assert '"pending_mail": 3' in out


@pytest.mark.asyncio
async def test_failed_fetch_returns_empty(monkeypatch):
    async def fake_fetch(url):
        return None

    monkeypatch.setattr(user_context, "_fetch", fake_fetch)
    assert await user_context_addendum("t", {"user_context_enabled": True,
                                             "user_context_url": "https://x/{token}"}) == ""
