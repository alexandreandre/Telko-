"""
Agrégation des statistiques d'usage LLM pour le comparateur, avec stockage
dans Supabase (table `llm_runs`) : une ligne par exécution, notation mise à jour ensuite.

Si l'appel Supabase échoue, un fallback best-effort sur fichier JSONL local
(`backend/data/llm_runs.jsonl`) est conservé pour ne pas casser le comparateur.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
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
    id: str | None
    provider: str
    model: str
    response_time_ms: int
    first_token_ms: int
    total_tokens: int | None
    cost_total_usd: float | None
    ts: float
    rating: int | None = None

    @classmethod
    def from_meta(cls, meta: Dict[str, Any]) -> "LLMRun | None":
        """Construit un LLMRun minimal à partir de la structure meta envoyée par /chat (agrégats)."""
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
            return None

        rid = meta.get("run_id") or meta.get("id")
        run_uuid: str | None = None
        if isinstance(rid, str) and rid.strip():
            try:
                run_uuid = str(uuid.UUID(rid.strip()))
            except ValueError:
                run_uuid = None

        rating_raw = meta.get("rating")
        rating: int | None = None
        if rating_raw in (1, 2):
            rating = int(rating_raw)

        return cls(
            id=run_uuid,
            provider=str(provider),
            model=str(model),
            response_time_ms=response_time_ms,
            first_token_ms=first_token_ms,
            total_tokens=total_tokens,
            cost_total_usd=cost_total_usd,
            ts=float(meta.get("ts") or time.time()),
            rating=rating,
        )


def _json_safe_for_db(obj: Any) -> Any:
    """Sérialise pour une colonne jsonb (évite objets non JSON-native)."""
    try:
        return json.loads(json.dumps(obj, default=str))
    except (TypeError, ValueError):
        return {}


def _parse_run_uuid(meta: Dict[str, Any]) -> str | None:
    rid = meta.get("run_id") or meta.get("id")
    if not isinstance(rid, str) or not rid.strip():
        return None
    try:
        return str(uuid.UUID(rid.strip()))
    except ValueError:
        return None


def _row_payload_from_meta(meta: Dict[str, Any]) -> Dict[str, Any] | None:
    """
    Construit le dict d'insertion Supabase à partir du meta /chat.
    Exige un run_id UUID valide.
    """
    run_id = _parse_run_uuid(meta)
    if not run_id:
        logger.warning("record_llm_run — run_id UUID manquant ou invalide, insertion ignorée.")
        return None

    run = LLMRun.from_meta({**meta, "run_id": run_id})
    if run is None:
        return None

    usage = meta.get("usage") if isinstance(meta.get("usage"), dict) else {}
    usage_safe = _json_safe_for_db(usage)
    llm_t = (usage.get("llm") or {}) if isinstance(usage, dict) else {}
    emb_t = (usage.get("embeddings") or {}) if isinstance(usage, dict) else {}
    cost_b = (usage.get("cost") or {}) if isinstance(usage, dict) else {}

    def _opt_int(v: Any) -> int | None:
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return int(v)
        return None

    llm_pt = _opt_int(llm_t.get("prompt_tokens"))
    llm_ct = _opt_int(llm_t.get("completion_tokens"))
    llm_tot = _opt_int(llm_t.get("total_tokens"))
    emb_pt = _opt_int(emb_t.get("prompt_tokens"))
    emb_tot = _opt_int(emb_t.get("total_tokens"))

    cost_llm = cost_b.get("llm_usd")
    cost_emb = cost_b.get("embeddings_usd")
    cost_llm_f = float(cost_llm) if isinstance(cost_llm, (int, float)) else None
    cost_emb_f = float(cost_emb) if isinstance(cost_emb, (int, float)) else None

    conv = meta.get("conversation_id")
    conversation_id = str(conv).strip() if isinstance(conv, str) and conv.strip() else None

    return {
        "id": run_id,
        "provider": run.provider,
        "model": run.model,
        "conversation_id": conversation_id,
        "response_time_ms": run.response_time_ms,
        "first_token_ms": run.first_token_ms,
        "llm_prompt_tokens": llm_pt,
        "llm_completion_tokens": llm_ct,
        "llm_total_tokens": llm_tot,
        "embed_prompt_tokens": emb_pt,
        "embed_total_tokens": emb_tot,
        "total_tokens": run.total_tokens,
        "cost_llm_usd": cost_llm_f,
        "cost_embed_usd": cost_emb_f,
        "cost_total_usd": run.cost_total_usd,
        "usage": usage_safe,
        "ts": run.ts,
    }


def _ensure_log_dir() -> None:
    try:
        os.makedirs(_LOG_DIR, exist_ok=True)
    except OSError:
        pass


def _supabase_headers() -> Dict[str, str] | None:
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
    headers = _supabase_headers()
    if headers is None:
        return

    base_url = settings.supabase_url.rstrip("/")
    url = f"{base_url}/rest/v1/{_SUPABASE_TABLE}"

    try:
        # PostgREST : « return=minimal » doit aller dans Prefer, pas en query (?return=… est parsé comme filtre).
        post_headers = {**headers, "Prefer": "return=minimal"}
        with httpx.Client(timeout=3.0) as client:
            resp = client.post(url, headers=post_headers, json=payload)
        if not resp.is_success:
            logger.warning(
                "record_llm_run — échec insertion Supabase (%s): %s",
                resp.status_code,
                resp.text[:300],
            )
    except Exception as exc:  # pragma: no cover — dépend d'IO externe
        logger.warning("record_llm_run — erreur réseau Supabase: %s", exc)


def patch_llm_run_rating(run_id: str, rating: int) -> None:
    """
    Met à jour la notation (1 = pouce bas, 2 = pouce haut) sur une ligne `llm_runs`.
    Best-effort ; ne lève pas.
    """
    if rating not in (1, 2):
        return
    try:
        rid = str(uuid.UUID(run_id.strip()))
    except (ValueError, AttributeError):
        logger.warning("patch_llm_run_rating — run_id invalide: %r", run_id)
        return

    headers = _supabase_headers()
    if headers is None:
        return

    base_url = settings.supabase_url.rstrip("/")
    url = f"{base_url}/rest/v1/{_SUPABASE_TABLE}"
    params = {"id": f"eq.{rid}"}
    body = {
        "rating": rating,
        "rated_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        with httpx.Client(timeout=3.0) as client:
            resp = client.patch(url, headers=headers, params=params, json=body)
        if not resp.is_success:
            logger.warning(
                "patch_llm_run_rating — échec Supabase (%s): %s",
                resp.status_code,
                resp.text[:300],
            )
    except Exception as exc:  # pragma: no cover
        logger.warning("patch_llm_run_rating — erreur réseau Supabase: %s", exc)


def _iter_runs_supabase() -> Iterable[LLMRun]:
    headers = _supabase_headers()
    if headers is None:
        return []

    base_url = settings.supabase_url.rstrip("/")
    url = f"{base_url}/rest/v1/{_SUPABASE_TABLE}"
    params = {
        "select": (
            "id,provider,model,response_time_ms,first_token_ms,total_tokens,"
            "cost_total_usd,ts,rating"
        ),
        "order": "ts.asc",
        "limit": "100000",
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
                rid = row.get("id")
                run_id_str = str(rid) if rid is not None else None
                rating_raw = row.get("rating")
                rating: int | None = None
                if rating_raw in (1, 2):
                    rating = int(rating_raw)

                runs.append(
                    LLMRun(
                        id=run_id_str,
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
                        rating=rating,
                    )
                )
            except Exception:
                continue
        return runs
    except Exception as exc:  # pragma: no cover
        logger.warning("build_usage_aggregates — erreur réseau Supabase: %s", exc)
        return []


def record_llm_run(meta: Dict[str, Any]) -> None:
    """
    Enregistre une exécution LLM dans Supabase, avec fallback fichier local.

    Appelée depuis l'endpoint /chat quand le chunk "meta" est reçu.
    """
    payload = _row_payload_from_meta(meta)
    if payload is None:
        run = LLMRun.from_meta(meta)
        if run is None:
            return
        _ensure_log_dir()
        try:
            line = {
                "provider": run.provider,
                "model": run.model,
                "response_time_ms": run.response_time_ms,
                "first_token_ms": run.first_token_ms,
                "total_tokens": run.total_tokens,
                "cost_total_usd": run.cost_total_usd,
                "ts": run.ts,
            }
            with open(_LOG_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
        except OSError:
            pass
        return

    _insert_run_supabase(payload)

    _ensure_log_dir()
    try:
        with open(_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
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
                    rid = raw.get("id")
                    run_id_str = str(rid) if rid is not None else None
                    rating_raw = raw.get("rating")
                    rating: int | None = None
                    if rating_raw in (1, 2):
                        rating = int(rating_raw)

                    runs.append(
                        LLMRun(
                            id=run_id_str,
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
                            rating=rating,
                        )
                    )
                except Exception:
                    continue
    except OSError:
        return []

    return runs


def _iter_runs() -> Iterable[LLMRun]:
    runs = list(_iter_runs_supabase())
    if runs:
        return runs
    return _iter_runs_file()


def _feedback_stats_by_model_id(raw_stats: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
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


def _rated_stats_from_runs(model_runs: List[LLMRun]) -> tuple[int, float | None, str]:
    """(nombre de runs notés, satisfaction %, provider)."""
    rated = [r for r in model_runs if r.rating is not None]
    if not rated:
        return 0, None, model_runs[0].provider if model_runs else "openrouter"
    n = len(rated)
    up = sum(1 for r in rated if r.rating == 2)
    prov = rated[-1].provider
    return n, round(100.0 * up / n, 1), prov


def build_usage_aggregates(
    model_catalog: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], List[Dict[str, Any]]]:
    """
    Agrège les exécutions LLM par modèle pour alimenter le comparateur.

    Retourne un tuple :
      - usage_rows : stats par modèle
      - global_stats : agrégats globaux
      - feedback_stats : satisfaction depuis les lignes `llm_runs` notées, complétée par SQLite héritée
    """
    try:
        raw_feedback = get_feedback_store().get_stats()
    except Exception:  # pragma: no cover
        logger.warning("build_usage_aggregates — lecture feedback SQLite impossible", exc_info=True)
        raw_feedback = []
    feedback_by_model = _feedback_stats_by_model_id(raw_feedback)

    runs = list(_iter_runs())

    feedback_stats: list[dict[str, Any]] = []
    # Stats « feedback » par modèle à partir des runs notés
    by_model_runs: dict[str, list[LLMRun]] = defaultdict(list)
    for r in runs:
        key = r.model or settings.openrouter_llm_model
        by_model_runs[key].append(r)

    seen_fb_models: set[str] = set()
    for mid, mruns in by_model_runs.items():
        rated_n, sat_pct, prov = _rated_stats_from_runs(mruns)
        if rated_n <= 0:
            continue
        rated_only = [r for r in mruns if r.rating is not None]
        avg_rt = round(sum(r.response_time_ms for r in rated_only) / len(rated_only))
        total_c = sum(r.cost_total_usd or 0.0 for r in rated_only)
        feedback_stats.append(
            {
                "provider": prov,
                "model": mid,
                "count": rated_n,
                "avg_response_time_ms": avg_rt,
                "total_cost_usd": round(total_c, 6),
                "satisfaction_rate": sat_pct,
            }
        )
        seen_fb_models.add(mid)

    for row in raw_feedback:
        mid = str(row.get("model") or "").strip()
        if not mid or mid in seen_fb_models:
            continue
        feedback_stats.append(
            {
                "provider": str(row.get("provider") or "openrouter"),
                "model": mid,
                "count": int(row.get("count") or 0),
                "avg_response_time_ms": int(row.get("avg_response_time_ms") or 0),
                "total_cost_usd": float(row.get("total_cost_usd") or 0),
                "satisfaction_rate": float(row.get("satisfaction_rate") or 0),
            }
        )

    feedback_stats.sort(key=lambda x: (-float(x["satisfaction_rate"]), x["model"]))

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

        rated_n, sat_from_runs, prov_from_runs = _rated_stats_from_runs(model_runs)
        fb_row = feedback_by_model.get(model_id)

        if rated_n > 0:
            rated_only = [r for r in model_runs if r.rating is not None]
            avg_rt_rated = round(sum(r.response_time_ms for r in rated_only) / len(rated_only))
            total_c_rated = sum(r.cost_total_usd or 0.0 for r in rated_only)
            rated_n_out = rated_n
            sat_pct = sat_from_runs
            feedback_block = {
                "provider": prov_from_runs,
                "model": model_id,
                "count": rated_n_out,
                "avg_response_time_ms": avg_rt_rated,
                "total_cost_usd": round(total_c_rated, 6),
                "satisfaction_rate": sat_pct,
            }
        elif fb_row:
            rated_n_out = int(fb_row["count"])
            sat_pct = float(fb_row["satisfaction_rate"])
            feedback_block = {
                "provider": str(fb_row["provider"]),
                "model": model_id,
                "count": rated_n_out,
                "avg_response_time_ms": int(fb_row["avg_response_time_ms"]),
                "total_cost_usd": float(fb_row["total_cost_usd"]),
                "satisfaction_rate": sat_pct,
            }
        else:
            rated_n_out = 0
            sat_pct = None
            feedback_block = None

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
                "rated_run_count": rated_n_out,
                "satisfaction_from_runs_pct": sat_pct,
                "feedback": feedback_block,
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
