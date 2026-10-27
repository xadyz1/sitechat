"""
Document upload and management API routes.
"""
import os
import uuid
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends, BackgroundTasks
from pydantic import BaseModel
from loguru import logger

from app.database import get_mongodb, get_vector_store
from app.services.document_processor import get_document_processor, DocumentProcessor
from app.services.indexer import get_indexer_service
from app.routes.auth import require_auth


router = APIRouter(prefix="/api/documents", tags=["Documents"])


class DocumentResponse(BaseModel):
    id: str
    filename: str
    file_type: str
    word_count: int
    status: str
    uploaded_at: str


class DocumentListResponse(BaseModel):
    documents: List[DocumentResponse]
    total: int


@router.get("/supported-types")
async def get_supported_types():
    """Get list of supported document types."""
    processor = get_document_processor()
    return {
        "supported_extensions": processor.get_supported_types(),
        "max_file_size_mb": processor.MAX_FILE_SIZE // (1024 * 1024)
    }


@router.post("/upload/{site_id}")
async def upload_documents(
    site_id: str,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    user: dict = Depends(require_auth)
):
    """
    Upload documents to a site's knowledge base.
    Supports: PDF, DOCX, TXT, MD, CSV, PPTX, XLSX
    """
    mongodb = await get_mongodb()
    processor = get_document_processor()
    
    # Verify site exists and user has access
    site = await mongodb.db.sites.find_one({"site_id": site_id})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    user_id = str(user["_id"])
    if site.get("user_id") and site["user_id"] != user_id and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    
    results = []
    documents_to_index = []
    
    for file in files:
        # Validate file type
        if not processor.is_supported(file.filename):
            results.append({
                "filename": file.filename,
                "success": False,
                "error": f"Unsupported file type. Supported: {', '.join(processor.get_supported_types())}"
            })
            continue
        
        try:
            # Read file content
            content = await file.read()
            
            # Process document
            result = await processor.process_file(content, file.filename, file.content_type)
            
            if not result['success']:
                results.append({
                    "filename": file.filename,
                    "success": False,
                    "error": result['error']
                })
                continue
            
            # Generate document ID
            doc_id = str(uuid.uuid4())[:12]
            
            # Save document metadata to MongoDB
            doc_record = {
                "doc_id": doc_id,
                "site_id": site_id,
                "filename": file.filename,
                "file_type": result['file_type'],
                "word_count": result['word_count'],
                "char_count": result['char_count'],
                "metadata": result['metadata'],
                "status": "processing",
                "uploaded_at": datetime.utcnow(),
                "uploaded_by": user_id
            }
            
            await mongodb.db.documents.insert_one(doc_record)
            
            # Queue for indexing
            documents_to_index.append({
                "doc_id": doc_id,
                "site_id": site_id,
                "filename": file.filename,
                "text": result['text'],
                "metadata": result['metadata']
            })
            
            results.append({
                "filename": file.filename,
                "success": True,
                "doc_id": doc_id,
                "word_count": result['word_count']
            })
            
        except Exception as e:
            logger.error(f"Error uploading {file.filename}: {e}")
            results.append({
                "filename": file.filename,
                "success": False,
                "error": str(e)
            })
    
    # Index documents in background
    if documents_to_index:
        background_tasks.add_task(index_documents, documents_to_index, site_id)
    
    # Update site to indicate it has documents
    await mongodb.db.sites.update_one(
        {"site_id": site_id},
        {"$set": {"has_documents": True, "updated_at": datetime.utcnow()}}
    )
    
    successful = sum(1 for r in results if r.get('success'))
    
    return {
        "message": f"Uploaded {successful} of {len(files)} documents",
        "results": results,
        "total_uploaded": successful
    }


async def index_documents(documents: List[dict], site_id: str):
    """Index uploaded documents into the vector store."""
    for doc in documents:
        await _index_single_document(site_id, doc)


async def _index_single_document(site_id: str, doc: dict):
    """Index one document record (reusable by text blocks / business info)."""
    mongodb = await get_mongodb()
    indexer = get_indexer_service()

    try:
        # Create page-like data for indexer
        pages = [{
            "url": f"doc://{site_id}/{doc['doc_id']}",
            "title": doc['filename'],
            "content": doc['text'],
            "metadata": {
                **doc['metadata'],
                "source_type": doc['metadata'].get("source_type", "document"),
                "doc_id": doc['doc_id'],
                "site_id": site_id
            }
        }]

        # Index the document
        stats = await indexer.index_pages(pages)

        # Update document status
        await mongodb.db.documents.update_one(
            {"doc_id": doc['doc_id']},
            {"$set": {
                "status": "indexed",
                "chunks_created": stats.get('total_chunks', 0),
                "indexed_at": datetime.utcnow()
            }}
        )

        logger.info(f"Indexed document {doc['filename']} with {stats.get('total_chunks', 0)} chunks")

    except Exception as e:
        logger.error(f"Error indexing document {doc['filename']}: {e}")
        await mongodb.db.documents.update_one(
            {"doc_id": doc['doc_id']},
            {"$set": {"status": "error", "error": str(e)}}
        )


async def _remove_document_vectors(site_id: str, doc_id: str):
    """Remove a document's vectors from the store (best-effort)."""
    try:
        vector_store = get_vector_store()
        vector_store.delete_by_metadata({"url": f"doc://{site_id}/{doc_id}"})
    except Exception as e:
        logger.warning(f"Error deleting document vectors for {doc_id}: {e}")


async def _check_site_access(site_id: str, user: dict):
    """Shared site access check used by the knowledge endpoints."""
    mongodb = await get_mongodb()
    site = await mongodb.db.sites.find_one({"site_id": site_id})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    user_id = str(user["_id"])
    if site.get("user_id") and site["user_id"] != user_id and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    return site


@router.get("/{site_id}")
async def list_documents(
    site_id: str,
    user: dict = Depends(require_auth)
):
    """Get all documents for a site."""
    mongodb = await get_mongodb()
    
    # Verify site access
    site = await mongodb.db.sites.find_one({"site_id": site_id})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    user_id = str(user["_id"])
    if site.get("user_id") and site["user_id"] != user_id and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Get documents
    cursor = mongodb.db.documents.find({"site_id": site_id})
    documents = await cursor.to_list(length=1000)
    
    return {
        "documents": [
            {
                "id": doc["doc_id"],
                "filename": doc["filename"],
                "file_type": doc["file_type"],
                "word_count": doc.get("word_count", 0),
                "chunks": doc.get("chunks_created", 0),
                "status": doc["status"],
                "uploaded_at": doc["uploaded_at"].isoformat() if doc.get("uploaded_at") else None,
                # Raw text is only stored for dashboard-editable sources (text blocks, business info)
                **({"content": doc["content"]} if doc.get("content") else {})
            }
            for doc in documents
        ],
        "total": len(documents)
    }


@router.delete("/{site_id}/{doc_id}")
async def delete_document(
    site_id: str,
    doc_id: str,
    user: dict = Depends(require_auth)
):
    """Delete a document from a site."""
    mongodb = await get_mongodb()
    vector_store = get_vector_store()
    
    # Verify site access
    site = await mongodb.db.sites.find_one({"site_id": site_id})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    user_id = str(user["_id"])
    if site.get("user_id") and site["user_id"] != user_id and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Find document
    doc = await mongodb.db.documents.find_one({"doc_id": doc_id, "site_id": site_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete from vector store
    try:
        doc_url = f"doc://{site_id}/{doc_id}"
        vector_store.delete_by_metadata({"url": doc_url})
    except Exception as e:
        logger.warning(f"Error deleting document vectors: {e}")
    
    # Delete from MongoDB
    await mongodb.db.documents.delete_one({"doc_id": doc_id})
    
    # Check if site still has documents
    remaining = await mongodb.db.documents.count_documents({"site_id": site_id})
    if remaining == 0:
        await mongodb.db.sites.update_one(
            {"site_id": site_id},
            {"$set": {"has_documents": False}}
        )
    
    return {"success": True, "message": "Document deleted"}


# ==================== Knowledge: Text Blocks ====================


class TextBlockBody(BaseModel):
    title: str
    content: str


def _word_count(text: str) -> int:
    return len((text or "").split())


@router.post("/text/{site_id}")
async def create_text_block(
    site_id: str,
    body: TextBlockBody,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth),
):
    """Add a free-text knowledge block to a site (indexed for RAG)."""
    await _check_site_access(site_id, user)
    mongodb = await get_mongodb()

    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Content is required")

    doc_id = str(uuid.uuid4())[:12]
    await mongodb.db.documents.insert_one({
        "doc_id": doc_id,
        "site_id": site_id,
        "filename": body.title.strip() or "Text block",
        "file_type": "text_block",
        "word_count": _word_count(body.content),
        "char_count": len(body.content),
        "content": body.content,
        "metadata": {"source_type": "text_block"},
        "status": "processing",
        "uploaded_at": datetime.utcnow(),
        "uploaded_by": str(user["_id"]),
    })

    background_tasks.add_task(_index_single_document, site_id, {
        "doc_id": doc_id,
        "filename": body.title.strip() or "Text block",
        "text": body.content,
        "metadata": {"source_type": "text_block"},
    })

    await mongodb.db.sites.update_one(
        {"site_id": site_id},
        {"$set": {"has_documents": True, "updated_at": datetime.utcnow()}},
    )
    return {"success": True, "doc_id": doc_id}


@router.put("/text/{site_id}/{doc_id}")
async def update_text_block(
    site_id: str,
    doc_id: str,
    body: TextBlockBody,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth),
):
    """Update a text block and re-index it."""
    await _check_site_access(site_id, user)
    mongodb = await get_mongodb()

    doc = await mongodb.db.documents.find_one(
        {"doc_id": doc_id, "site_id": site_id, "file_type": "text_block"}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Text block not found")
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Content is required")

    await _remove_document_vectors(site_id, doc_id)
    await mongodb.db.documents.update_one(
        {"doc_id": doc_id},
        {"$set": {
            "filename": body.title.strip() or "Text block",
            "content": body.content,
            "word_count": _word_count(body.content),
            "char_count": len(body.content),
            "status": "processing",
            "updated_at": datetime.utcnow(),
        }},
    )

    background_tasks.add_task(_index_single_document, site_id, {
        "doc_id": doc_id,
        "filename": body.title.strip() or "Text block",
        "text": body.content,
        "metadata": {"source_type": "text_block"},
    })
    return {"success": True, "doc_id": doc_id}


# ==================== Knowledge: Business Information ====================


BUSINESS_INFO_DOC_ID = "business-info"


class BusinessInfoBody(BaseModel):
    content: str


@router.get("/business-info/{site_id}")
async def get_business_info(site_id: str, user: dict = Depends(require_auth)):
    """Get the site's business information block."""
    await _check_site_access(site_id, user)
    mongodb = await get_mongodb()
    doc = await mongodb.db.documents.find_one(
        {"doc_id": BUSINESS_INFO_DOC_ID, "site_id": site_id}
    )
    return {
        "content": doc.get("content", "") if doc else "",
        "updated_at": doc.get("updated_at") or (doc.get("uploaded_at") if doc else None),
    }


@router.put("/business-info/{site_id}")
async def update_business_info(
    site_id: str,
    body: BusinessInfoBody,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth),
):
    """Create/update the site's business information block (indexed for RAG)."""
    await _check_site_access(site_id, user)
    mongodb = await get_mongodb()

    await _remove_document_vectors(site_id, BUSINESS_INFO_DOC_ID)

    if not body.content.strip():
        # Empty content = clear the block
        await mongodb.db.documents.delete_one(
            {"doc_id": BUSINESS_INFO_DOC_ID, "site_id": site_id}
        )
        return {"success": True, "cleared": True}

    await mongodb.db.documents.update_one(
        {"doc_id": BUSINESS_INFO_DOC_ID, "site_id": site_id},
        {"$set": {
            "filename": "Business information",
            "file_type": "business_info",
            "content": body.content,
            "word_count": _word_count(body.content),
            "char_count": len(body.content),
            "metadata": {"source_type": "business_info"},
            "status": "processing",
            "updated_at": datetime.utcnow(),
            "uploaded_by": str(user["_id"]),
        }, "$setOnInsert": {"uploaded_at": datetime.utcnow()}},
        upsert=True,
    )

    background_tasks.add_task(_index_single_document, site_id, {
        "doc_id": BUSINESS_INFO_DOC_ID,
        "filename": "Business information",
        "text": body.content,
        "metadata": {"source_type": "business_info"},
    })

    await mongodb.db.sites.update_one(
        {"site_id": site_id},
        {"$set": {"has_documents": True, "updated_at": datetime.utcnow()}},
    )
    return {"success": True, "doc_id": BUSINESS_INFO_DOC_ID}
