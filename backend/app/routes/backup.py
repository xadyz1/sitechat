"""Full-platform backup & restore (master only).

Export: one JSON bundle with every site + its knowledge/help-center/products,
platform settings and (optionally) user accounts with password hashes.
Restore: upserts by site_id, reassigns ownership by owner e-mail (falls back
to the importing master), replaces per-site collections, optionally queues
a re-crawl so vectors are rebuilt (vector indexes are never exported).

A fresh install (zero users) may restore WITHOUT auth — same trust model as
ADMIN_PASSWORD bootstrap — so a backup can seed a brand-new deployment.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel

from app.database import get_mongodb
from app.routes.auth import require_auth, get_current_user
from app.routes.platform import _is_master

router = APIRouter(prefix="/api/platform", tags=["Backup"])

BUNDLE_VERSION = 1
SITE_COLLECTIONS = ["qa_pairs", "help_categories", "help_articles", "documents", "products"]
USER_FIELDS = ("email", "name", "password_hash", "role", "plan", "avatar_url", "is_active",
               "must_change_password", "assigned_site_ids", "created_at")


def _clean(doc: Dict) -> Dict:
    out = {}
    for k, v in doc.items():
        if k == "_id":
            continue
        out[k] = str(v) if isinstance(v, ObjectId) else v
    return out


def _json_default(o):
    if isinstance(o, (datetime,)):
        return o.isoformat()
    if isinstance(o, ObjectId):
        return str(o)
    return str(o)


def _parse_dates(doc: Dict) -> Dict:
    for k in ("created_at", "updated_at", "uploaded_at", "indexed_at", "published_at"):
        v = doc.get(k)
        if isinstance(v, str):
            try:
                doc[k] = datetime.fromisoformat(v)
            except ValueError:
                pass
    return doc


async def _require_master_user(user: dict):
    if not _is_master(user):
        raise HTTPException(status_code=403, detail="Platform owner access required")


@router.get("/backup")
async def export_backup(include_users: bool = True, user: dict = Depends(require_auth)):
    """Download a full platform backup bundle."""
    await _require_master_user(user)
    db = await get_mongodb()

    users = {str(u["_id"]): u async for u in db.db.users.find({})}
    sites = []
    async for s in db.db.sites.find({}):
        site = _clean(s)
        owner = users.get(s.get("user_id") or "")
        site["owner_email"] = (owner or {}).get("email")
        site.pop("user_id", None)
        sid = s["site_id"]
        site["related"] = {}
        for coll in SITE_COLLECTIONS:
            q = {"domain": _domain(s.get("url"))} if coll == "products" else {"site_id": sid}
            site["related"][coll] = [_clean(d) async for d in db.db[coll].find(q)]
        sites.append(site)

    bundle: Dict[str, Any] = {
        "version": BUNDLE_VERSION,
        "exported_at": datetime.utcnow().isoformat(),
        "sites": sites,
        "platform_settings": [_clean(p) async for p in db.db.platform_settings.find({})],
    }
    if include_users:
        bundle["users"] = [{k: _clean(u).get(k) for k in USER_FIELDS if k in u} for u in users.values()]

    import json
    body = json.dumps(bundle, default=_json_default, ensure_ascii=False)
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M")
    return JSONResponse(
        content=json.loads(body),
        headers={"Content-Disposition": f'attachment; filename="swiftchat-backup-{stamp}.json"'},
    )


def _domain(url: Optional[str]) -> str:
    from app.services.products import site_domain
    return site_domain(url or "")


class RestoreOptions(BaseModel):
    bundle: Dict[str, Any]
    recrawl: bool = True
    overwrite: bool = True


@router.get("/restore/status")
async def restore_status():
    """Public: tells the login page whether this is a fresh install that may restore without auth."""
    db = await get_mongodb()
    return {"fresh": await db.db.users.count_documents({}) == 0}


@router.post("/restore")
async def restore_backup(body: RestoreOptions, background_tasks: BackgroundTasks,
                         importer: Optional[dict] = Depends(get_current_user)):
    """Restore a backup bundle. Auth: master — or no auth on a fresh install (zero users)."""
    db = await get_mongodb()
    fresh = await db.db.users.count_documents({}) == 0
    if not fresh and (not importer or not _is_master(importer)):
        raise HTTPException(status_code=403, detail="Platform owner access required")

    bundle = body.bundle or {}
    if bundle.get("version") != BUNDLE_VERSION or "sites" not in bundle:
        raise HTTPException(status_code=400, detail="Not a valid SwiftChat backup bundle")

    stats = {"users_created": 0, "users_skipped": 0, "sites": 0, "related": 0, "recrawl_queued": 0}

    # Users first so ownership can be resolved by e-mail
    for u in bundle.get("users") or []:
        email = (u.get("email") or "").lower().strip()
        if not email or not u.get("password_hash"):
            continue
        if await db.db.users.find_one({"email": email}):
            stats["users_skipped"] += 1
            continue
        doc = _parse_dates({k: v for k, v in u.items() if k in USER_FIELDS})
        doc["email"] = email
        doc.setdefault("created_at", datetime.utcnow())
        doc["updated_at"] = datetime.utcnow()
        await db.db.users.insert_one(doc)
        stats["users_created"] += 1

    email_to_id = {u["email"].lower(): str(u["_id"]) async for u in db.db.users.find({}, {"email": 1})}
    fallback_owner = str(importer["_id"]) if importer else next(iter(email_to_id.values()), None)

    for site in bundle["sites"]:
        sid = site.get("site_id")
        if not sid:
            continue
        related = site.pop("related", {}) or {}
        owner_email = (site.pop("owner_email", None) or "").lower()
        doc = _parse_dates(dict(site))
        doc["user_id"] = email_to_id.get(owner_email) or fallback_owner
        doc["updated_at"] = datetime.utcnow()
        doc.setdefault("created_at", datetime.utcnow())
        exists = await db.db.sites.find_one({"site_id": sid})
        if exists and not body.overwrite:
            continue
        await db.db.sites.update_one({"site_id": sid}, {"$set": doc}, upsert=True)
        stats["sites"] += 1

        for coll in SITE_COLLECTIONS:
            docs = related.get(coll) or []
            q = {"domain": _domain(doc.get("url"))} if coll == "products" else {"site_id": sid}
            await db.db[coll].delete_many(q)
            if docs:
                await db.db[coll].insert_many([_parse_dates(dict(d)) for d in docs])
                stats["related"] += len(docs)

        if body.recrawl and doc.get("url"):
            from app.routes.embed import crawl_and_index_site
            background_tasks.add_task(crawl_and_index_site, doc["url"], sid, 150)
            stats["recrawl_queued"] += 1
        # Re-index uploaded/text/video documents (vectors weren't exported)
        for d in related.get("documents") or []:
            if d.get("content"):
                from app.routes.documents import _index_single_document
                background_tasks.add_task(_index_single_document, sid, {
                    "doc_id": d["doc_id"], "filename": d.get("filename", "Document"),
                    "text": d["content"], "metadata": d.get("metadata") or {},
                })

    for p in bundle.get("platform_settings") or []:
        if p.get("type"):
            await db.db.platform_settings.update_one({"type": p["type"]}, {"$set": _parse_dates(dict(p))}, upsert=True)

    logger.info(f"Backup restored: {stats}")
    return {"success": True, **stats, "fresh_install": fresh}
