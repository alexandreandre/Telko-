import json
from typing import AsyncIterator

import httpx

from core.llm.base import BaseLLMProvider, LLMProviderError

_API_URL = "https://api.anthropic.com/v1/messages"


def _split_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    """Sépare le message system des autres messages."""
    system = ""
    others: list[dict] = []
    for msg in messages:
        if msg["role"] == "system" and not system:
            system = msg["content"]
        else:
            others.append({"role": msg["role"], "content": msg["content"]})
    return system, others


class AnthropicProvider(BaseLLMProvider):
    def __init__(
        self,
        api_key: str,
        model: str = "claude-3-haiku-20240307",
        timeout: float = 60.0,
    ) -> None:
        self.model = model
        self.timeout = timeout
        self._headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

    async def generate(self, messages: list[dict]) -> str:
        system, others = _split_messages(messages)
        payload: dict = {"model": self.model, "max_tokens": 4096, "messages": others}
        if system:
            payload["system"] = system

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(_API_URL, headers=self._headers, json=payload)
        except httpx.ConnectError as exc:
            raise LLMProviderError("anthropic", "Anthropic inaccessible — vérifier la connexion réseau") from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError("anthropic", f"Timeout après {self.timeout}s") from exc
        except httpx.RequestError as exc:
            raise LLMProviderError("anthropic", f"Erreur réseau : {exc}") from exc

        if resp.status_code != 200:
            raise LLMProviderError("anthropic", resp.text, status_code=resp.status_code)

        data = resp.json()
        return data["content"][0]["text"].strip()

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        system, others = _split_messages(messages)
        payload: dict = {"model": self.model, "max_tokens": 4096, "messages": others, "stream": True}
        if system:
            payload["system"] = system

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", _API_URL, headers=self._headers, json=payload) as resp:
                    if resp.status_code != 200:
                        await resp.aread()
                        raise LLMProviderError("anthropic", resp.text, status_code=resp.status_code)
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        raw = line[len("data: "):]
                        try:
                            event = json.loads(raw)
                            if event.get("type") == "content_block_delta":
                                text = event["delta"].get("text", "")
                                if text:
                                    yield text
                        except (json.JSONDecodeError, KeyError):
                            continue
        except httpx.ConnectError as exc:
            raise LLMProviderError("anthropic", "Anthropic inaccessible — vérifier la connexion réseau") from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError("anthropic", f"Timeout après {self.timeout}s") from exc
        except httpx.RequestError as exc:
            raise LLMProviderError("anthropic", f"Erreur réseau : {exc}") from exc
