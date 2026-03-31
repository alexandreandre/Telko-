from abc import ABC, abstractmethod
from typing import AsyncIterator


class LLMProviderError(Exception):
    def __init__(self, provider: str, message: str, status_code: int | None = None) -> None:
        self.provider = provider
        self.message = message
        self.status_code = status_code
        super().__init__(str(self))

    def __str__(self) -> str:
        base = f"[{self.provider}] {self.message}"
        if self.status_code is not None:
            return f"{base} (HTTP {self.status_code})"
        return base


class BaseLLMProvider(ABC):
    @abstractmethod
    async def generate(self, messages: list[dict]) -> str:
        ...

    @abstractmethod
    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        yield  # makes this an abstract async generator
