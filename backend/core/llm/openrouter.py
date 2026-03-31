import json
import logging
from typing import AsyncIterator, AsyncGenerator, TypedDict

import httpx

from core.llm.base import BaseLLMProvider, LLMProviderError
from config import settings

logger = logging.getLogger(__name__)

_API_URL = "https://openrouter.ai/api/v1/chat/completions"


class OpenRouterUsage(TypedDict, total=False):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost: float
    # Champs supplémentaires possibles, mais optionnels pour notre usage
    # prompt_tokens_details: dict
    # completion_tokens_details: dict
    # cost_details: dict


class OpenRouterProvider(BaseLLMProvider):
    def __init__(self, api_key: str, model: str = "openrouter/auto", timeout: float = 60.0) -> None:
        self.model = model
        self.timeout = timeout
        self._api_key = api_key

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        if settings.openrouter_site_url:
            headers["HTTP-Referer"] = settings.openrouter_site_url
        if settings.openrouter_app_title:
            headers["X-OpenRouter-Title"] = settings.openrouter_app_title
        return headers

    async def generate(self, messages: list[dict]) -> str:
        payload = {"model": self.model, "messages": messages, "stream": False}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(_API_URL, headers=self._headers(), json=payload)
        except httpx.ConnectError as exc:
            raise LLMProviderError("openrouter", "OpenRouter inaccessible — vérifier la connexion réseau") from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError("openrouter", f"Timeout après {self.timeout}s") from exc
        except httpx.RequestError as exc:
            raise LLMProviderError("openrouter", f"Erreur réseau : {exc}") from exc

        if resp.status_code != 200:
            raise LLMProviderError("openrouter", resp.text, status_code=resp.status_code)

        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()

    async def stream(
        self, messages: list[dict]
    ) -> AsyncGenerator[tuple[str | None, OpenRouterUsage | None], None]:
        payload = {"model": self.model, "messages": messages, "stream": True}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", _API_URL, headers=self._headers(), json=payload) as resp:
                    if resp.status_code != 200:
                        await resp.aread()
                        raise LLMProviderError("openrouter", resp.text, status_code=resp.status_code)
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        raw = line[len("data: "):]
                        if raw == "[DONE]":
                            break
                        try:
                            chunk = json.loads(raw)
                            usage: OpenRouterUsage | None = chunk.get("usage")  # type: ignore[assignment]
                            content = ""
                            try:
                                content = chunk["choices"][0]["delta"].get("content", "")
                            except (KeyError, IndexError, TypeError):
                                content = ""

                            if content or usage:
                                # content peut être vide sur le dernier chunk qui ne contient que l'usage.
                                yield content or None, usage
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue
        except httpx.ConnectError as exc:
            raise LLMProviderError("openrouter", "OpenRouter inaccessible — vérifier la connexion réseau") from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError("openrouter", f"Timeout après {self.timeout}s") from exc
        except httpx.RequestError as exc:
            raise LLMProviderError("openrouter", f"Erreur réseau : {exc}") from exc

