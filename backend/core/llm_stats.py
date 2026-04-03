"""
Agrégation des statistiques d'usage LLM pour le comparateur, avec stockage
dans Supabase pour permettre un pilotage direct des lignes.

Comportement :
- enregistrement de chaque run LLM dans la table Supabase `llm_runs`
- agrégation en mémoire à chaque appel de l'endpoint /api/llm/comparator

Si l'appel Supabase échoue, un fallback best-effort sur fichier JSONL local
(`backend/data/llm_runs.jsonl`) est conservé pour ne pas casser le comparateur.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Tuple

import httpx

from config import settings
from core.feedback_store import get_feedback_store


logger = logging.getLogger(__name__)

_LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
_LOG_PATH = os.path.join(_LOG_DIR, "llm_runs.jsonl")
_SUPABASE_TABLE = "llm_runs"


@dataclass
class LLMRun:
    provider: str
    model: str
    response_time_ms: int
    first_token_ms: int
    total_tokens: int | None
    cost_total_usd: float | None
    ts: float

    @classmethod
    def from_meta(cls, meta: Dict[str, Any]) -> "LLMRun | None":
        """Construit un LLMRun à partir de la structure meta envoyée par /chat."""
        provider = meta.get("provider") or "openrouter"
        model = meta.get("model") or settings.openrouter_llm_model
        try:
            timing = meta.get("timing") or {}
            usage = meta.get("usage") or {}
            llm_tokens = (usage.get("llm") or {}) if isinstance(usage, dict) else {}
            embed_tokens = (usage.get("embeddings") or {}) if isinstance(usage, dict) else {}
            cost = (usage.get("cost") or {}) if isinstance(usage, dict) else {}

            response_time_ms = int(round(float(timing.get("response_time_ms") or 0)))
            first_token_ms = int(round(float(timing.get("first_token_ms") or response_time_ms)))
            total_tokens_raw = llm_tokens.get("total_tokens")
            embed_raw = embed_tokens.get("total_tokens")
            llm_n = int(total_tokens_raw) if isinstance(total_tokens_raw, (int, float)) else None
            embed_n = int(embed_raw) if isinstance(embed_raw, (int, float)) else None
            if llm_n is not None and embed_n is not None:
                total_tokens = llm_n + embed_n
            elif llm_n is not None:
                total_tokens = llm_n
            elif embed_n is not None:
                total_tokens = embed_n
            else:
                total_tokens = None

            total_cost_raw = cost.get("total_usd")
            cost_total_usd = float(total_cost_raw) if isinstance(total_cost_raw, (int, float)) else None
        except Exception:
            # On évite de casser la requête utilisateur pour une erreur de parsing.
            return None

        return cls(
            provider=str(provider),
            model=str(model),
            response_time_ms=response_time_ms,
            first_token_ms=first_token_ms,
            total_tokens=total_tokens,
            cost_total_usd=cost_total_usd,
            ts=time.time(),
        )


def _ensure_log_dir() -> None:
    try:
        os.makedirs(_LOG_DIR, exist_ok=True)
    except OSError:
        # Si on ne peut pas créer le répertoire, on ne bloque pas la requête.
        pass


def _supabase_headers() -> Dict[str, str] | None:
    """Construit les en-têtes REST Supabase à partir des settings."""
    base_url = settings.supabase_url or ""
    api_key = settings.supabase_service_role_key or settings.supabase_anon_key
    if not base_url or not api_key:
        return None
    return {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _insert_run_supabase(payload: Dict[str, Any]) -> None:
    """
    Insère un run dans Supabase (table `llm_runs`).

    Cette fonction est best-effort : en cas d'erreur, elle logge et laisse
    la main au fallback fichier.
    """
    headers = _supabase_headers()
    if headers is None:
        return

    base_url = settings.supabase_url.rstrip("/")
    url = f"{base_url}/rest/v1/{_SUPABASE_TABLE}"

    try:
        with httpx.Client(timeout=3.0) as client:
            resp = client.post(url, headers=headers, json=payload, params={"return": "minimal"})
        if not resp.is_success:
            logger.warning(
                "record_llm_run — échec insertion Supabase (%s): %s",
                resp.status_code,
                resp.text[:300],
            )
    except Exception as exc:  # pragma: no cover — dépend d'IO externe
        logger.warning("record_llm_run — erreur réseau Supabase: %s", exc)


def _iter_runs_supabase() -> Iterable[LLMRun]:
    """
    Lit les runs depuis Supabase (table `llm_runs`).

    Pour piloter les lignes depuis Supabase :
      - INSERT pour ajouter des runs
      - DELETE / UPDATE pour corriger ou supprimer des lignes
    """
    headers = _supabase_headers()
    if headers is None:
        return []

    base_url = settings.supabase_url.rstrip("/")
    url = f"{base_url}/rest/v1/{_SUPABASE_TABLE}"
    params = {
        "select": "provider,model,response_time_ms,first_token_ms,total_tokens,cost_total_usd,ts",
        "order": "ts.asc",
        "limit": 100000,
    }

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url, headers=headers, params=params)
        if not resp.is_success:
            logger.warning(
                "build_usage_aggregates — échec lecture Supabase (%s): %s",
                resp.status_code,
                resp.text[:300],
            )
            return []

        rows = resp.json()
        if not isinstance(rows, list):
            logger.warning("build_usage_aggregates — réponse Supabase inattendue: %r", rows)
            return []

        runs: List[LLMRun] = []
        for row in rows:
            try:
                runs.append(
                    LLMRun(
                        provider=str(row.get("provider", "openrouter")),
                        model=str(row.get("model", settings.openrouter_llm_model)),
                        response_time_ms=int(row.get("response_time_ms") or 0),
                        first_token_ms=int(row.get("first_token_ms") or 0),
                        total_tokens=(
                            int(row.get("total_tokens"))
                            if isinstance(row.get("total_tokens"), (int, float))
                            else None
                        ),
                        cost_total_usd=(
                            float(row.get("cost_total_usd"))
                            if isinstance(row.get("cost_total_usd"), (int, float))
                            else None
                        ),
                        ts=float(row.get("ts") or 0.0),
                    )
                )
            except Exception:
                continue
        return runs
    except Exception as exc:  # pragma: no cover — dépend d'IO externe
        logger.warning("build_usage_aggregates — erreur réseau Supabase: %s", exc)
        return []


def record_llm_run(meta: Dict[str, Any]) -> None:
    """
    Enregistre une exécution LLM dans Supabase, avec fallback fichier local.

    Appelée depuis l'endpoint /chat quand le chunk "meta" est reçu.
    """
    run = LLMRun.from_meta(meta)
    if run is None:
        return

    payload = {
        "provider": run.provider,
        "model": run.model,
        "response_time_ms": run.response_time_ms,
        "first_token_ms": run.first_token_ms,
        "total_tokens": run.total_tokens,
        "cost_total_usd": run.cost_total_usd,
        "ts": run.ts,
    }

    # Écriture Supabase (best-effort)
    _insert_run_supabase(payload)

    # Fallback local pour ne pas perdre les données si Supabase est indisponible.
    _ensure_log_dir()
    try:
        with open(_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        # Journalisation best-effort uniquement.
        return


def _iter_runs_file() -> Iterable[LLMRun]:
    if not os.path.exists(_LOG_PATH):
        return []

    runs: List[LLMRun] = []
    try:
        with open(_LOG_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    raw = json.loads(line)
                    runs.append(
                        LLMRun(
                            provider=str(raw.get("provider", "openrouter")),
                            model=str(raw.get("model", settings.openrouter_llm_model)),
                            response_time_ms=int(raw.get("response_time_ms") or 0),
                            first_token_ms=int(raw.get("first_token_ms") or 0),
                            total_tokens=(
                                int(raw.get("total_tokens"))
                                if isinstance(raw.get("total_tokens"), (int, float))
                                else None
                            ),
                            cost_total_usd=(
                                float(raw.get("cost_total_usd"))
                                if isinstance(raw.get("cost_total_usd"), (int, float))
                                else None
                            ),
                            ts=float(raw.get("ts") or 0.0),
                        )
                    )
                except Exception:
                    # Ligne corrompue : on l'ignore.
                    continue
    except OSError:
        return []

    return runs


def _iter_runs() -> Iterable[LLMRun]:
    """
    Source unique des runs, priorisant Supabase puis le fichier local.
    """
    runs = list(_iter_runs_supabase())
    if runs:
        return runs
    return _iter_runs_file()


def _feedback_stats_by_model_id(raw_stats: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    Indexe les stats SQLite par id de modèle OpenRouter (colonne `model` du feedback).
    Fusionne plusieurs lignes (ex. même modèle, providers distincts) par moyennes pondérées.
    """
    merged: Dict[str, Dict[str, Any]] = {}
    for row in raw_stats:
        mid = str(row.get("model") or "").strip()
        if not mid:
            continue
        try:
            count = int(row.get("count") or 0)
        except (TypeError, ValueError):
            count = 0
        if count <= 0:
            continue
        sat = float(row.get("satisfaction_rate") or 0.0)
        art = row.get("avg_response_time_ms")
        avg_rt = float(art) if isinstance(art, (int, float)) and not isinstance(art, bool) else None
        tcost = row.get("total_cost_usd")
        total_c = float(tcost) if isinstance(tcost, (int, float)) and not isinstance(tcost, bool) else 0.0
        prov = str(row.get("provider") or "openrouter")

        if mid not in merged:
            merged[mid] = {
                "provider": prov,
                "model": mid,
                "count": count,
                "avg_response_time_ms": avg_rt if avg_rt is not None else 0.0,
                "total_cost_usd": total_c,
                "satisfaction_rate": sat,
            }
            continue

        cur = merged[mid]
        n0, n1 = int(cur["count"]), count
        n = n0 + n1
        cur["satisfaction_rate"] = (float(cur["satisfaction_rate"]) * n0 + sat * n1) / n
        cur_rt = float(cur.get("avg_response_time_ms") or 0.0)
        if avg_rt is not None:
            cur["avg_response_time_ms"] = (cur_rt * n0 + avg_rt * n1) / n
        cur["total_cost_usd"] = float(cur.get("total_cost_usd") or 0.0) + total_c
        cur["count"] = n

    for cur in merged.values():
        cur["satisfaction_rate"] = round(float(cur["satisfaction_rate"]), 1)
        cur["avg_response_time_ms"] = round(float(cur.get("avg_response_time_ms") or 0.0))

    return merged


def build_usage_aggregates(
    model_catalog: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], List[Dict[str, Any]]]:
    """
    Agrège les exécutions LLM par modèle pour alimenter le comparateur.

    Retourne un tuple :
      - usage_rows : stats par modèle
      - global_stats : agrégats globaux
      - feedback_stats : satisfaction (% pouces haut) agrégée depuis SQLite (`feedbacks`)
    """
    try:
        raw_feedback = get_feedback_store().get_stats()
    except Exception:  # pragma: no cover — SQLite / disque
        logger.warning("build_usage_aggregates — lecture feedback SQLite impossible", exc_info=True)
        raw_feedback = []
    feedback_by_model = _feedback_stats_by_model_id(raw_feedback)
    feedback_stats: list[dict[str, Any]] = [
        {
            "provider": v["provider"],
            "model": v["model"],
            "count": v["count"],
            "avg_response_time_ms": v["avg_response_time_ms"],
            "total_cost_usd": v["total_cost_usd"],
            "satisfaction_rate": v["satisfaction_rate"],
        }
        for v in sorted(
            feedback_by_model.values(),
            key=lambda x: (-float(x["satisfaction_rate"]), x["model"]),
        )
    ]

    runs = list(_iter_runs())
    if not runs:
        return [], {
            "total_generation_runs": 0,
            "total_cost_usd_observed": 0.0,
            "distinct_models_used": 0,
        }, feedback_stats

    by_model: dict[str, list[LLMRun]] = defaultdict(list)
    for r in runs:
        key = r.model or settings.openrouter_llm_model
        by_model[key].append(r)

    # Index catalogue par id pour éventuellement enrichir les lignes d'usage.
    catalog_index: dict[str, Dict[str, Any]] = {m.get("id"): m for m in model_catalog}

    usage_rows: list[dict[str, Any]] = []
    total_cost = 0.0
    total_runs = 0

    for model_id, model_runs in by_model.items():
        n = len(model_runs)
        total_runs += n

        sum_resp = sum(r.response_time_ms for r in model_runs)
        sum_first = sum(r.first_token_ms for r in model_runs)
        tokens_list = [r.total_tokens for r in model_runs if r.total_tokens is not None]
        costs_list = [r.cost_total_usd for r in model_runs if r.cost_total_usd is not None]

        avg_resp = sum_resp / n if n else None
        avg_first = sum_first / n if n else None
        avg_tokens = (sum(tokens_list) / len(tokens_list)) if tokens_list else None
        total_cost_model = sum(c for c in costs_list if c is not None)
        avg_cost_run = (total_cost_model / n) if n and total_cost_model else None

        total_cost += total_cost_model

        fb_row = feedback_by_model.get(model_id)
        rated_n = int(fb_row["count"]) if fb_row else 0
        sat_pct = float(fb_row["satisfaction_rate"]) if fb_row else None

        usage_rows.append(
            {
                "model": model_id,
                "run_count": n,
                "avg_response_time_ms": avg_resp,
                "avg_retrieval_ms": None,
                "avg_first_token_ms": avg_first,
                "total_cost_usd": total_cost_model,
                "avg_cost_per_run_usd": avg_cost_run,
                "avg_total_tokens": avg_tokens,
                "rated_run_count": rated_n,
                "satisfaction_from_runs_pct": sat_pct,
                "feedback": (
                    {
                        "provider": str(fb_row["provider"]),
                        "model": model_id,
                        "count": rated_n,
                        "avg_response_time_ms": int(fb_row["avg_response_time_ms"]),
                        "total_cost_usd": float(fb_row["total_cost_usd"]),
                        "satisfaction_rate": sat_pct,
                    }
                    if fb_row
                    else None
                ),
                # Enrichissement avec les métadonnées du catalogue, si disponible.
                "catalog": catalog_index.get(model_id),
                "local_hardware_hint": (catalog_index.get(model_id) or {}).get("local_hardware_hint"),
            }
        )

    global_stats = {
        "total_generation_runs": total_runs,
        "total_cost_usd_observed": total_cost,
        "distinct_models_used": len(by_model),
    }

    return usage_rows, global_stats, feedback_stats

