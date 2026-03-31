import asyncio
import sys
import time

from backend.config import settings
from backend.core.llm import LLMProviderError, get_llm_provider


async def main() -> None:
    print(f"Provider : ollama")
    print(f"Modèle   : {settings.ollama_llm_model}")
    print(f"URL      : {settings.ollama_base_url}\n")

    llm = get_llm_provider()

    # Test 1 — generate()
    print("── Test generate() ──────────────────")
    t0 = time.perf_counter()
    try:
        result = await llm.generate([
            {"role": "user", "content": "Réponds uniquement : système opérationnel."}
        ])
        print(f"Réponse  : {result}")
        print(f"Durée    : {time.perf_counter() - t0:.2f}s\n")
    except LLMProviderError as e:
        print(f"ERREUR : {e}\n", file=sys.stderr)

    # Test 2 — stream()
    print("── Test stream() ────────────────────")
    t0 = time.perf_counter()
    try:
        async for chunk in llm.stream([
            {"role": "user", "content": "Compte jusqu'à 5 lentement."}
        ]):
            print(chunk, end="", flush=True)
        print(f"\nDurée    : {time.perf_counter() - t0:.2f}s\n")
    except LLMProviderError as e:
        print(f"\nERREUR : {e}\n", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
