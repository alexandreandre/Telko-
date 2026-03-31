import json
from typing import AsyncIterator

import httpx

from core.llm.base import BaseLLMProvider, LLMProviderError

_API_URL = "https://api.openai.com/v1/chat/completions"


class OpenAIProvider(BaseLLMProvider):
    def __init__(self, api_key: str, model: str = "gpt-4o-mini", timeout: float = 60.0) -> None:
        self.model = model
        self.timeout = timeout
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def generate(self, messages: list[dict]) -> str:
        payload = {"model": self.model, "messages": messages, "stream": False}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(_API_URL, headers=self._headers, json=payload)
        except httpx.ConnectError as exc:
            raise LLMProviderError("openai", "OpenAI inaccessible — vérifier la connexion réseau") from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError("openai", f"Timeout après {self.timeout}s") from exc
        except httpx.RequestError as exc:
            raise LLMProviderError("openai", f"Erreur réseau : {exc}") from exc

        if resp.status_code != 200:
            raise LLMProviderError("openai", resp.text, status_code=resp.status_code)

        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        payload = {"model": self.model, "messages": messages, "stream": True}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", _API_URL, headers=self._headers, json=payload) as resp:
                    if resp.status_code != 200:
                        await resp.aread()
                        raise LLMProviderError("openai", resp.text, status_code=resp.status_code)
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        raw = line[len("data: "):]
                        if raw == "[DONE]":
                            break
                        try:
                            chunk = json.loads(raw)
                            content = chunk["choices"][0]["delta"].get("content", "")
                            if content:
                                yield content
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue
        except httpx.ConnectError as exc:
            raise LLMProviderError("openai", "OpenAI inaccessible — vérifier la connexion réseau") from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError("openai", f"Timeout après {self.timeout}s") from exc
        except httpx.RequestError as exc:
            raise LLMProviderError("openai", f"Erreur réseau : {exc}") from exc
