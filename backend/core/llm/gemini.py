import json
from typing import AsyncIterator

import httpx

from core.llm.base import BaseLLMProvider, LLMProviderError

_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"


def _to_gemini_messages(messages: list[dict]) -> list[dict]:
    """Convertit les messages OpenAI-like en format Gemini (role 'assistant' → 'model')."""
    return [
        {
            "role": "model" if msg["role"] == "assistant" else msg["role"],
            "parts": [{"text": msg["content"]}],
        }
        for msg in messages
        if msg["role"] != "system"  # Gemini ne supporte pas le rôle system ici
    ]


class GeminiProvider(BaseLLMProvider):
    def __init__(self, api_key: str, model: str = "gemini-1.5-flash", timeout: float = 60.0) -> None:
        self.model = model
        self.timeout = timeout
        self._api_key = api_key

    async def generate(self, messages: list[dict]) -> str:
        url = f"{_BASE_URL}/{self.model}:generateContent?key={self._api_key}"
        payload = {"contents": _to_gemini_messages(messages)}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, json=payload)
        except httpx.ConnectError as exc:
            raise LLMProviderError("gemini", "Gemini inaccessible — vérifier la connexion réseau") from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError("gemini", f"Timeout après {self.timeout}s") from exc
        except httpx.RequestError as exc:
            raise LLMProviderError("gemini", f"Erreur réseau : {exc}") from exc

        if resp.status_code != 200:
            raise LLMProviderError("gemini", resp.text, status_code=resp.status_code)

        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        url = f"{_BASE_URL}/{self.model}:streamGenerateContent?key={self._api_key}&alt=sse"
        payload = {"contents": _to_gemini_messages(messages)}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", url, json=payload) as resp:
                    if resp.status_code != 200:
                        await resp.aread()
                        raise LLMProviderError("gemini", resp.text, status_code=resp.status_code)
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        raw = line[len("data: "):]
                        if raw == "[DONE]":
                            break
                        try:
                            chunk = json.loads(raw)
                            text = chunk["candidates"][0]["content"]["parts"][0]["text"]
                            if text:
                                yield text
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue
        except httpx.ConnectError as exc:
            raise LLMProviderError("gemini", "Gemini inaccessible — vérifier la connexion réseau") from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError("gemini", f"Timeout après {self.timeout}s") from exc
        except httpx.RequestError as exc:
            raise LLMProviderError("gemini", f"Erreur réseau : {exc}") from exc
