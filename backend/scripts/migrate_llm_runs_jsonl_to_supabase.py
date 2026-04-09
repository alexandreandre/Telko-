#!/usr/bin/env python3
"""
Import ponctuel : `backend/data/llm_runs.jsonl` → table Supabase `llm_runs`.

Les lignes sans `id` UUID reçoivent un id déterministe (uuid5) pour pouvoir relancer
le script sans dupliquer les mêmes entrées (upsert PostgREST).

Usage (depuis le dossier `backend/`, avec `.env` à la racine du dépôt ou sous `backend/`) :

    python scripts/migrate_llm_runs_jsonl_to_supabase.py
    python scripts/migrate_llm_runs_jsonl_to_supabase.py --dry-run
    python scripts/migrate_llm_runs_jsonl_to_supabase.py --jsonl /chemin/vers/fichier.jsonl

Prérequis : appliquer les migrations Supabase (colonnes `conversation_id`, extraits, etc.).
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

import httpx

# Racine `backend/` (parent du dossier `scripts/`)
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from config import settings  # noqa: E402

_TABLE = "llm_runs"
_JSONL_DEFAULT = _BACKEND_ROOT / "data" / "llm_runs.jsonl"
# Namespace fixe pour ids dérivés du contenu d'une ligne sans id
_NS_JSONL_IMPORT = uuid.UUID("8c5b2c0e-4f1a-5e2b-9c3d-7a6b5c4d3e2f")


def _json_safe(obj: object) -> object:
    try:
        return json.loads(json.dumps(obj, default=str))
    except (TypeError, ValueError):
        return {}


def _opt_int(v: object) -> int | None:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return int(v)
    return None


def _stable_run_id(raw: dict) -> str:
    rid = raw.get("id")
    if rid is not None:
        try:
            return str(uuid.UUID(str(rid).strip()))
        except ValueError:
            pass
    blob = json.dumps(raw, sort_keys=True, ensure_ascii=True, default=str)
    return str(uuid.uuid5(_NS_JSONL_IMPORT, blob))


def jsonl_line_to_row(raw: dict) -> dict:
    """Aligné sur les colonnes attendues par `public.llm_runs`."""
    run_id = _stable_run_id(raw)
    provider = str(raw.get("provider") or "openrouter")
    model_raw = raw.get("model")
    model = (
        str(model_raw).strip()
        if isinstance(model_raw, str) and model_raw.strip()
        else settings.openrouter_llm_model
    )

    conv = raw.get("conversation_id")
    conversation_id = str(conv).strip() if isinstance(conv, str) and conv.strip() else None

    response_time_ms = int(raw.get("response_time_ms") or 0)
    first_token_ms = int(raw.get("first_token_ms") or response_time_ms)

    usage = raw.get("usage") if isinstance(raw.get("usage"), dict) else {}
    usage_safe = _json_safe(usage)
    llm_t = (usage.get("llm") or {}) if isinstance(usage, dict) else {}
    emb_t = (usage.get("embeddings") or {}) if isinstance(usage, dict) else {}
    cost_b = (usage.get("cost") or {}) if isinstance(usage, dict) else {}

    llm_pt = _opt_int(llm_t.get("prompt_tokens"))
    llm_ct = _opt_int(llm_t.get("completion_tokens"))
    llm_tot = _opt_int(llm_t.get("total_tokens"))
    emb_pt = _opt_int(emb_t.get("prompt_tokens"))
    emb_tot = _opt_int(emb_t.get("total_tokens"))

    tt_top = raw.get("total_tokens")
    if isinstance(tt_top, (int, float)) and not isinstance(tt_top, bool):
        total_tokens = int(tt_top)
    elif llm_tot is not None and emb_tot is not None:
        total_tokens = llm_tot + emb_tot
    elif llm_tot is not None:
        total_tokens = llm_tot
    elif emb_tot is not None:
        total_tokens = emb_tot
    else:
        total_tokens = None

    cost_llm = cost_b.get("llm_usd")
    cost_emb = cost_b.get("embeddings_usd")
    cost_llm_f = float(cost_llm) if isinstance(cost_llm, (int, float)) else None
    cost_emb_f = float(cost_emb) if isinstance(cost_emb, (int, float)) else None

    c_tot = raw.get("cost_total_usd")
    cost_total_usd = float(c_tot) if isinstance(c_tot, (int, float)) else None
    if cost_total_usd is None:
        cu = cost_b.get("total_usd")
        cost_total_usd = float(cu) if isinstance(cu, (int, float)) else None

    ts_raw = raw.get("ts")
    ts = float(ts_raw) if isinstance(ts_raw, (int, float)) else 0.0

    row: dict = {
        "id": run_id,
        "provider": provider,
        "model": model,
        "conversation_id": conversation_id,
        "response_time_ms": response_time_ms,
        "first_token_ms": first_token_ms,
        "llm_prompt_tokens": llm_pt,
        "llm_completion_tokens": llm_ct,
        "llm_total_tokens": llm_tot,
        "embed_prompt_tokens": emb_pt,
        "embed_total_tokens": emb_tot,
        "total_tokens": total_tokens,
        "cost_llm_usd": cost_llm_f,
        "cost_embed_usd": cost_emb_f,
        "cost_total_usd": cost_total_usd,
        "usage": usage_safe,
        "ts": ts,
    }

    rating_raw = raw.get("rating")
    if rating_raw in (1, 2):
        row["rating"] = int(rating_raw)
    ra = raw.get("rated_at")
    if isinstance(ra, str) and ra.strip():
        row["rated_at"] = ra.strip()

    uex = raw.get("user_prompt_excerpt")
    if isinstance(uex, str) and uex.strip():
        row["user_prompt_excerpt"] = uex.strip()[:8000]
    aex = raw.get("assistant_response_excerpt")
    if isinstance(aex, str) and aex.strip():
        row["assistant_response_excerpt"] = aex.strip()[:32000]

    return row


def main() -> int:
    p = argparse.ArgumentParser(description="Import llm_runs.jsonl vers Supabase")
    p.add_argument(
        "--jsonl",
        type=Path,
        default=_JSONL_DEFAULT,
        help=f"Chemin du fichier JSONL (défaut: {_JSONL_DEFAULT})",
    )
    p.add_argument("--dry-run", action="store_true", help="Affiche le nombre de lignes sans écrire")
    p.add_argument("--batch-size", type=int, default=80, help="Lignes par requête POST")
    args = p.parse_args()

    path: Path = args.jsonl
    if not path.is_file():
        print(f"Fichier introuvable : {path}", file=sys.stderr)
        return 1

    base_url = (settings.supabase_url or "").rstrip("/")
    key = settings.supabase_service_role_key or settings.supabase_anon_key
    if not base_url or not key:
        print("supabase_url et une clé (service_role de préférence) sont requis.", file=sys.stderr)
        return 1

    rows: list[dict] = []
    with path.open(encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"Ligne {lineno} JSON invalide : {e}", file=sys.stderr)
                return 1
            if not isinstance(raw, dict):
                print(f"Ligne {lineno} : objet JSON attendu", file=sys.stderr)
                return 1
            rows.append(jsonl_line_to_row(raw))

    print(f"{len(rows)} ligne(s) à importer depuis {path}")
    if args.dry_run:
        return 0

    url = f"{base_url}/rest/v1/{_TABLE}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=minimal,resolution=merge-duplicates",
    }

    batch = max(1, int(args.batch_size))
    for i in range(0, len(rows), batch):
        chunk = rows[i : i + batch]
        try:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(url, headers=headers, json=chunk)
        except Exception as exc:
            print(f"Erreur réseau batch {i // batch + 1}: {exc}", file=sys.stderr)
            return 1
        if not resp.is_success:
            print(
                f"Échec batch {i // batch + 1} ({resp.status_code}): {resp.text[:500]}",
                file=sys.stderr,
            )
            return 1
        print(f"  OK batch {i // batch + 1} ({len(chunk)} lignes)")

    print("Import terminé.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
