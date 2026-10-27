"""
Configuration settings for the SwiftChat Platform.
Supports multiple providers for LLM, embeddings, vector store, database, storage, and cache.
"""
import secrets
from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
from typing import Literal, Optional, List


class Settings(BaseSettings):
    # App settings
    APP_NAME: str = "SwiftChat"
    DEBUG: bool = False
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    SITE_URL: str = "http://localhost:8000"
    
    # ===========================================
    # Security Settings
    # ===========================================
    # CORS - comma-separated list of allowed origins
    CORS_ORIGINS: str = (
        "http://localhost:3000,http://localhost:8000,http://127.0.0.1:8000,"
        "http://localhost:8015,http://127.0.0.1:8015,"
        "http://localhost:8012,http://127.0.0.1:8012,"
        # Default HTTP port (80): browsers send Origin without an explicit port
        "http://127.0.0.1,http://localhost"
    )
    CORS_ALLOW_CREDENTIALS: bool = True
    # Match loopback on any port (CORS Origin is exact; http://127.0.0.1 does not match :8012).
    # Set to empty string in .env to disable.
    CORS_ORIGIN_REGEX: str = r"^https?://127\.0\.0\.1(?::\d+)?$"
    
    # Trusted hosts for production
    TRUSTED_HOSTS: str = "localhost,127.0.0.1"
    
    # Security headers
    ENABLE_SECURITY_HEADERS: bool = True
    # Full Content-Security-Policy for non-API HTML (/, /app, static pages). Empty = omit CSP header.
    # Configure in .env — see .env.example.
    CONTENT_SECURITY_POLICY: str = ""
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS_ORIGINS into a list."""
        if self.CORS_ORIGINS == "*":
            return ["*"]
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def cors_origin_regex(self) -> Optional[str]:
        """Optional regex for allowed Origins (e.g. 127.0.0.1 with any port)."""
        if not self.CORS_ORIGIN_REGEX or not str(self.CORS_ORIGIN_REGEX).strip():
            return None
        return str(self.CORS_ORIGIN_REGEX).strip()

    @property
    def content_security_policy_non_api(self) -> Optional[str]:
        """CSP for HTML routes; None when unset so the header is not sent."""
        raw = (self.CONTENT_SECURITY_POLICY or "").strip()
        return raw if raw else None
    
    @property
    def trusted_hosts_list(self) -> List[str]:
        """Parse TRUSTED_HOSTS into a list."""
        if self.TRUSTED_HOSTS == "*":
            return ["*"]
        return [host.strip() for host in self.TRUSTED_HOSTS.split(",") if host.strip()]
    
    # ===========================================
    # LLM Provider Configuration
    # ===========================================
    LLM_PROVIDER: Literal["ollama", "openai", "anthropic", "azure"] = "ollama"
    LLM_MODEL: str = "llama3.1:8b"
    LLM_TEMPERATURE: float = 0.7
    LLM_MAX_TOKENS: int = 1000
    # Ollama: cap context window for faster attention (omit by setting 0 or use model default if unset)
    OLLAMA_NUM_CTX: int = 4096
    
    # Provider-specific API keys
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    AZURE_OPENAI_ENDPOINT: Optional[str] = None
    AZURE_OPENAI_API_KEY: Optional[str] = None
    AZURE_OPENAI_DEPLOYMENT: Optional[str] = None
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    
    # ===========================================
    # Embeddings Provider Configuration
    # ===========================================
    EMBEDDINGS_PROVIDER: Literal["ollama", "openai", "huggingface"] = "huggingface"
    EMBEDDINGS_MODEL: str = "all-MiniLM-L6-v2"
    
    # ===========================================
    # Vector Store Provider Configuration
    # ===========================================
    VECTOR_STORE_PROVIDER: Literal["faiss", "chroma", "pinecone", "qdrant"] = "faiss"
    
    # FAISS settings
    FAISS_INDEX_PATH: str = "./data/faiss_index"
    
    # Chroma settings
    CHROMA_PERSIST_DIR: str = "./data/chroma_db"
    CHROMA_COLLECTION_NAME: str = "sitechat_docs"
    
    # Pinecone settings
    PINECONE_API_KEY: Optional[str] = None
    PINECONE_INDEX: Optional[str] = None
    PINECONE_ENVIRONMENT: Optional[str] = None
    
    # Qdrant settings
    QDRANT_URL: Optional[str] = None
    QDRANT_API_KEY: Optional[str] = None
    QDRANT_COLLECTION: str = "sitechat"
    
    # ===========================================
    # Database Provider Configuration
    # ===========================================
    DATABASE_PROVIDER: Literal["mongodb", "postgresql"] = "mongodb"
    
    # MongoDB settings
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB: str = "sitechat"
    
    # PostgreSQL settings
    POSTGRESQL_URL: Optional[str] = None
    
    # ===========================================
    # Storage Provider Configuration
    # ===========================================
    STORAGE_PROVIDER: Literal["local", "s3", "gcs"] = "local"
    
    # Local storage settings
    LOCAL_STORAGE_PATH: str = "./data/uploads"
    
    # S3 settings
    S3_BUCKET: Optional[str] = None
    S3_REGION: Optional[str] = None
    S3_ACCESS_KEY: Optional[str] = None
    S3_SECRET_KEY: Optional[str] = None
    
    # GCS settings
    GCS_BUCKET: Optional[str] = None
    GCS_CREDENTIALS_PATH: Optional[str] = None
    
    # ===========================================
    # Cache Provider Configuration
    # ===========================================
    CACHE_PROVIDER: Literal["memory", "redis"] = "memory"
    
    # Redis settings
    REDIS_URL: Optional[str] = None
    CACHE_TTL: int = 300  # Default TTL in seconds
    
    # ===========================================
    # Auth settings
    # ===========================================
    JWT_SECRET: str = "CHANGE-THIS-SECRET-IN-PRODUCTION"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24
    
    # Admin credentials (created on first run if no admin exists)
    # Set ADMIN_PASSWORD to empty string to disable auto-creation
    ADMIN_EMAIL: str = "admin@example.com"
    ADMIN_PASSWORD: str = ""
    
    # Password policy
    MIN_PASSWORD_LENGTH: int = 8
    REQUIRE_PASSWORD_COMPLEXITY: bool = True
    
    @property
    def is_jwt_secret_secure(self) -> bool:
        """Check if JWT secret is properly configured."""
        insecure_defaults = [
            "your-super-secret-key-change-in-production",
            "CHANGE-THIS-SECRET-IN-PRODUCTION",
            "secret",
            "changeme",
            ""
        ]
        return (
            self.JWT_SECRET not in insecure_defaults and
            len(self.JWT_SECRET) >= 32
        )
    
    @property
    def is_production(self) -> bool:
        """Check if running in production mode."""
        return self.ENVIRONMENT == "production" and not self.DEBUG
    
    # ===========================================
    # Push notifications (OneSignal) — account-level defaults.
    # Per-site/channel overrides live at site.notifications via the
    # /api/sites/{id}/notifications endpoints.
    # ===========================================
    ONESIGNAL_APP_ID: Optional[str] = None
    ONESIGNAL_REST_API_KEY: Optional[str] = None
    ONESIGNAL_SAFARI_WEB_ID: Optional[str] = None

    # ===========================================
    # Payments — Stripe (subscriptions & finance)
    # ===========================================
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_PUBLISHABLE_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    STRIPE_PRICE_BASIC_MONTHLY: Optional[str] = None
    STRIPE_PRICE_BASIC_YEARLY: Optional[str] = None
    STRIPE_PRICE_ADVANCED_MONTHLY: Optional[str] = None
    STRIPE_PRICE_ADVANCED_YEARLY: Optional[str] = None
    STRIPE_CURRENCY: str = "eur"

    # ===========================================
    # Email — SMTP (transactional mail, alerts, invites)
    # ===========================================
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM: Optional[str] = None
    SMTP_USE_TLS: bool = True

    # ===========================================
    # Additional AI providers
    # ===========================================
    DEEPSEEK_API_KEY: Optional[str] = None
    DEEPSEEK_BASE_URL: Optional[str] = None
    GOOGLE_API_KEY: Optional[str] = None
    GROQ_API_KEY: Optional[str] = None
    MISTRAL_API_KEY: Optional[str] = None
    COHERE_API_KEY: Optional[str] = None
    OPENROUTER_API_KEY: Optional[str] = None

    # Platform owner — full access to users management, plans and finance
    MASTER_ADMIN_EMAIL: Optional[str] = "ivandro.work@gmail.com"

    # ===========================================
    # RAG settings
    # ===========================================
    CHUNK_SIZE: int = 1000
    CHUNK_OVERLAP: int = 200
    # Fewer chunks = less prompt text = faster LLM (raise for richer answers)
    RETRIEVAL_K: int = 3
    # Vector search returns k * oversample candidates before grading (2 = faster than 4)
    RAG_RETRIEVAL_OVERSAMPLE: int = 2
    # Max characters per retrieved chunk in the chat prompt (lower = faster)
    RAG_CONTEXT_CHUNK_MAX_CHARS: int = 900
    # Recent messages included in prompt; each message truncated for speed
    CHAT_HISTORY_MAX_MESSAGES: int = 4
    CHAT_HISTORY_MESSAGE_MAX_CHARS: int = 350
    # When true, load history, Q&A check, and vector retrieval in parallel (faster RAG path).
    # Set false if Q&A hits are common and you want to skip wasted retrieval work.
    CHAT_SPECULATIVE_PREFETCH: bool = True
    
    # ===========================================
    # Crawler settings
    # ===========================================
    MAX_PAGES: int = 100
    CRAWL_DELAY: float = 1.0
    # Render pages through headless Chromium when static fetch yields a
    # JS shell (SPA sites). Requires playwright + chromium in the image;
    # degrades gracefully to static-only when unavailable.
    CRAWLER_JS_RENDER: bool = True
    
    # ===========================================
    # Rate limiting
    # ===========================================
    RATE_LIMIT_REQUESTS: int = 20
    RATE_LIMIT_WINDOW: int = 60
    
    # ===========================================
    # Conversation settings
    # ===========================================
    CONVERSATION_WINDOW_SIZE: int = 10

    # ===========================================
    # Backward Compatibility Aliases
    # ===========================================
    @property
    def MONGODB_URI(self) -> str:
        """Backward compatibility alias for MONGODB_URL."""
        return self.MONGODB_URL
    
    @property
    def MONGODB_DB_NAME(self) -> str:
        """Backward compatibility alias for MONGODB_DB."""
        return self.MONGODB_DB
    
    @property
    def SECRET_KEY(self) -> str:
        """Backward compatibility alias for JWT_SECRET."""
        return self.JWT_SECRET
    
    @property
    def OLLAMA_MODEL(self) -> str:
        """Backward compatibility alias for LLM_MODEL."""
        return self.LLM_MODEL
    
    @property
    def OLLAMA_EMBEDDING_MODEL(self) -> str:
        """Backward compatibility alias for EMBEDDINGS_MODEL."""
        return self.EMBEDDINGS_MODEL
    
    class Config:
        env_file = ".env"
        extra = "allow"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
