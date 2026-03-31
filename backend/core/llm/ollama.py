import json
from typing import AsyncIterator

import httpx

from core.llm.base import BaseLLMProvider, LLMProviderError

_PROVIDER = "ollama"


class OllamaProvider(BaseLLMProvider):
    def __init__(
        self,
        base_url: str,
        model: str,
        timeout: float = 120.0,
        options: dict | None = None,
    ) -> None:
        self.model = model
        self.timeout = timeout
        self.options = options or {}
        self._chat_url = f"{base_url.rstrip('/')}/api/chat"

    async def generate(self, messages: list[dict]) -> str:
        payload = {"model": self.model, "messages": messages, "stream": False}
        if self.options:
            payload["options"] = self.options
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(self._chat_url, json=payload)
        except httpx.ConnectError as exc:
            raise LLMProviderError(
                _PROVIDER, "Ollama inaccessible — vérifier `ollama serve`"
            ) from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError(
                _PROVIDER, f"Timeout après {self.timeout}s"
            ) from exc
        except httpx.RequestError as exc:
            raise LLMProviderError(
                _PROVIDER, f"Erreur réseau : {exc}"
            ) from exc

        if response.status_code != 200:
            raise LLMProviderError(_PROVIDER, response.text, status_code=response.status_code)

        data = response.json()
        return data["message"]["content"].strip()

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        payload = {"model": self.model, "messages": messages, "stream": True}
        if self.options:
            payload["options"] = self.options
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", self._chat_url, json=payload) as response:
                    if response.status_code != 200:
                        body = await response.aread()
                        raise LLMProviderError(
                            _PROVIDER, body.decode(), status_code=response.status_code
                        )
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        chunk = json.loads(line)
                        content = chunk.get("message", {}).get("content", "")
                        if content:
                            yield content
                        if chunk.get("done") is True:
                            break
        except LLMProviderError:
            raise
        except httpx.ConnectError as exc:
            raise LLMProviderError(
                _PROVIDER, "Ollama inaccessible — vérifier `ollama serve`"
            ) from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError(
                _PROVIDER, f"Timeout après {self.timeout}s"
            ) from exc
        except httpx.RequestError as exc:
            raise LLMProviderError(
                _PROVIDER, f"Erreur réseau : {exc}"
            ) from exc
