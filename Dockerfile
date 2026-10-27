# SwiftChat — all-in-one image (FastAPI backend + static frontend)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app/backend

# Python deps first for layer caching
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# App code + sibling frontend dir expected by app.main (project_root/frontend)
COPY backend/ ./
COPY frontend/ /app/frontend/

# Persistent data: FAISS index, uploads, HF model cache
ENV FAISS_INDEX_PATH=/app/backend/data/faiss_index \
    LOCAL_STORAGE_PATH=/app/backend/data/uploads \
    HF_HOME=/app/backend/data/hf_cache \
    SENTENCE_TRANSFORMERS_HOME=/app/backend/data/hf_cache

RUN mkdir -p /app/backend/data
VOLUME ["/app/backend/data"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/', timeout=5).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
