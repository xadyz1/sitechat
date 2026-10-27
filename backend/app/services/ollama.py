"""
Ollama LLM service for generating responses.
"""
import httpx
from typing import AsyncGenerator, Optional, Dict, Any
from loguru import logger

from app.config import settings

# Reuse one HTTP client per process (avoids TCP/TLS handshake overhead per chat).
_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(120.0),
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
        )
    return _http_client


def _ollama_options(temperature: float, max_tokens: int) -> Dict[str, Any]:
    opts: Dict[str, Any] = {
        "temperature": temperature,
        "num_predict": max_tokens,
    }
    # Smaller context = faster prefill; 0 = omit (use model default)
    nctx = getattr(settings, "OLLAMA_NUM_CTX", 0) or 0
    if nctx > 0:
        opts["num_ctx"] = nctx
    return opts


OPENAI_STYLE_PROVIDERS = {"openai", "deepseek", "groq", "litellm", "openai_compatible"}
_DEFAULT_BASES = {
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "groq": "https://api.groq.com/openai/v1",
}


def _resolve_openai_style() -> tuple:
    """(base_url, api_key) for the configured OpenAI-compatible provider."""
    p = settings.LLM_PROVIDER
    if p == "deepseek":
        return (settings.DEEPSEEK_BASE_URL or _DEFAULT_BASES[p]).rstrip("/"), settings.DEEPSEEK_API_KEY
    if p == "groq":
        return (settings.OPENAI_BASE_URL or _DEFAULT_BASES[p]).rstrip("/"), settings.GROQ_API_KEY or settings.OPENAI_API_KEY
    return (settings.OPENAI_BASE_URL or _DEFAULT_BASES["openai"]).rstrip("/"), settings.OPENAI_API_KEY


class OllamaService:
    """Chat LLM client. Speaks the native Ollama API, or the OpenAI-compatible
    chat-completions API when LLM_PROVIDER is openai/deepseek/groq/litellm/openai_compatible."""
    
    def __init__(self):
        self.openai_style = settings.LLM_PROVIDER in OPENAI_STYLE_PROVIDERS
        if self.openai_style:
            self.base_url, self.api_key = _resolve_openai_style()
            if not self.api_key:
                logger.warning(f"LLM_PROVIDER={settings.LLM_PROVIDER} but no API key configured")
        else:
            self.base_url = (settings.OLLAMA_BASE_URL or "").rstrip("/")
            self.api_key = None
        self.model = settings.OLLAMA_MODEL
        self.embedding_model = settings.OLLAMA_EMBEDDING_MODEL
        logger.info(f"LLM backend: {settings.LLM_PROVIDER} @ {self.base_url} (model {self.model})")

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key or 'none'}", "Content-Type": "application/json"}

    def _openai_payload(self, messages, temperature, max_tokens, stream):
        return {"model": self.model, "messages": messages, "temperature": temperature,
                "max_tokens": max_tokens, "stream": stream}

    def _openai_error(self, response: httpx.Response) -> str:
        body = (response.text or "").strip()[:500]
        return f"LLM API ({self.base_url}) returned status {response.status_code}: {body or '(empty)'}"

    def _http_error_detail(self, response: httpx.Response, endpoint: str) -> str:
        """Build a clear error when Ollama returns non-200 (404 is usually unknown model)."""
        code = response.status_code
        body = (response.text or "").strip()
        if len(body) > 500:
            body = body[:500] + "…"
        hint = ""
        if code == 404:
            hint = (
                f'Model "{self.model}" was not found at {self.base_url}. '
                f"Install it with: ollama pull {self.model} — then confirm `ollama list` and that "
                f"LLM_MODEL in .env matches the tag exactly. "
            )
        else:
            hint = f"Request: POST {self.base_url}{endpoint}. "
        return f"Ollama returned status {code}. {hint}Response: {body or '(empty)'}"
    
    async def generate(
        self,
        prompt: str,
        system_prompt: str = None,
        temperature: float = 0.7,
        max_tokens: int = 2000
    ) -> str:
        """
        Generate a response from the LLM.
        
        Args:
            prompt: The user prompt
            system_prompt: Optional system prompt
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
        
        Returns:
            The generated response text
        """
        messages = []
        
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        
        messages.append({"role": "user", "content": prompt})
        
        try:
            client = _get_http_client()
            if self.openai_style:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self._headers(),
                    json=self._openai_payload(messages, temperature, max_tokens, False),
                )
                if response.status_code != 200:
                    detail = self._openai_error(response)
                    logger.error(detail)
                    raise Exception(detail)
                data = response.json()
                choices = data.get("choices") or []
                return ((choices[0].get("message") or {}).get("content") or "") if choices else ""

            response = await client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": False,
                    "options": _ollama_options(temperature, max_tokens),
                },
            )

            if response.status_code != 200:
                detail = self._http_error_detail(response, "/api/chat")
                logger.error(detail)
                raise Exception(detail)

            data = response.json()
            return data.get("message", {}).get("content", "")

        except httpx.TimeoutException:
            logger.error("Ollama request timed out")
            raise Exception("LLM request timed out. Please try again.")
        except Exception as e:
            logger.error(f"Ollama error: {e}")
            raise
    
    async def generate_stream(
        self,
        prompt: str,
        system_prompt: str = None,
        temperature: float = 0.7,
        max_tokens: int = 2000
    ) -> AsyncGenerator[str, None]:
        """
        Stream a response from the LLM.
        
        Yields:
            Chunks of the generated response
        """
        messages = []
        
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        
        messages.append({"role": "user", "content": prompt})
        
        try:
            client = _get_http_client()
            if self.openai_style:
                import json
                async with client.stream(
                    "POST", f"{self.base_url}/chat/completions", headers=self._headers(),
                    json=self._openai_payload(messages, temperature, max_tokens, True),
                ) as response:
                    if response.status_code != 200:
                        await response.aread()
                        detail = self._openai_error(response)
                        logger.error(detail)
                        raise Exception(detail)
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            chunk = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        choices = chunk.get("choices") or []
                        delta = (choices[0].get("delta") or {}) if choices else {}
                        if delta.get("content"):
                            yield delta["content"]
                return

            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": True,
                    "options": _ollama_options(temperature, max_tokens),
                },
            ) as response:
                if response.status_code != 200:
                    detail = self._http_error_detail(response, "/api/chat")
                    logger.error(detail)
                    raise Exception(detail)

                async for line in response.aiter_lines():
                    if line:
                        import json
                        try:
                            data = json.loads(line)
                            content = data.get("message", {}).get("content", "")
                            if content:
                                yield content
                        except json.JSONDecodeError:
                            continue

        except Exception as e:
            logger.error(f"Ollama streaming error: {e}")
            raise
    
    async def check_health(self) -> bool:
        """Check if Ollama is available."""
        try:
            client = _get_http_client()
            if self.openai_style:
                response = await client.get(f"{self.base_url}/models", headers=self._headers(), timeout=8.0)
                return response.status_code == 200
            response = await client.get(f"{self.base_url}/api/tags", timeout=5.0)
            return response.status_code == 200
        except Exception:
            return False
    
    async def list_models(self) -> list:
        """List available models."""
        try:
            client = _get_http_client()
            if self.openai_style:
                response = await client.get(f"{self.base_url}/models", headers=self._headers(), timeout=10.0)
                if response.status_code == 200:
                    return [m.get("id") for m in (response.json().get("data") or []) if m.get("id")]
                return []
            response = await client.get(f"{self.base_url}/api/tags", timeout=10.0)
            if response.status_code == 200:
                data = response.json()
                return [m["name"] for m in data.get("models", [])]
            return []
        except Exception as e:
            logger.error(f"Error listing models: {e}")
            return []


# Singleton instance
_ollama_service: Optional[OllamaService] = None


def get_ollama_service() -> OllamaService:
    """Get or create OllamaService instance."""
    global _ollama_service
    if _ollama_service is None:
        _ollama_service = OllamaService()
    return _ollama_service
