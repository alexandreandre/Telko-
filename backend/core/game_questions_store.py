"""Liste partagée des suggestions de questions (Assistant) — JSON sur disque."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

DATA_PATH = Path(__file__).parent.parent / "data" / "assistant_game_questions.json"


def _default() -> dict[str, Any]:
    return {"items": []}


def load() -> dict[str, Any]:
    if not DATA_PATH.exists():
        return _default()
    try:
        with open(DATA_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _default()
    if not isinstance(data, dict):
        return _default()
    items = data.get("items")
    if not isinstance(items, list):
        return _default()
    normalized: list[dict[str, str]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        text = it.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        icon = it.get("icon")
        if not isinstance(icon, str):
            icon = "💬"
        icon = icon.strip() or "💬"
        normalized.append({"icon": icon[:32], "text": text.strip()[:2000]})
    return {"items": normalized}


def save(payload: dict[str, Any]) -> dict[str, Any]:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    fd, tmp = tempfile.mkstemp(
        dir=DATA_PATH.parent,
        prefix=".assistant_game_questions_",
        suffix=".json",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(raw)
        tmp_path = Path(tmp)
        tmp_path.replace(DATA_PATH)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise
    return load()
