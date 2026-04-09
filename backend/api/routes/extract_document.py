"""
POST /extract-document-text — extrait le texte d'un fichier binaire (même formats
que l'ingestion) pour indexation côté client, sans exécuter de contenu actif.
"""

import logging
import os
import tempfile
from pathlib import Path

import httpx
from fastapi import APIRouter, File, Header, UploadFile
from fastapi.responses import JSONResponse

from api.supabase_auth import get_supabase_user_id
from ingestion.file_parser import documents_to_plain_text, parse_file

logger = logging.getLogger(__name__)

router = APIRouter()

# Formats autorisés pour la base documentaire (alignés sur le frontend)
_KNOWLEDGE_EXTENSIONS = frozenset({
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
})

_MAX_BYTES = 35 * 1024 * 1024


def _safe_filename(raw: str | None) -> str:
    return Path(raw or "upload").name


def _validate_knowledge_binary(filename: str, head: bytes) -> str | None:
    """Retourne un message d'erreur ou None si OK."""
    ext = Path(filename).suffix.lower()
    if ext not in _KNOWLEDGE_EXTENSIONS:
        return "Extension non autorisée pour la base documentaire."
    if len(head) < 4:
        return "Fichier trop court ou vide."
    if ext == ".pdf":
        if not head.startswith(b"%PDF"):
            return "En-tête PDF invalide."
    elif ext in (".docx", ".xlsx", ".pptx"):
        if not head.startswith(b"PK\x03\x04"):
            return "Fichier Office Open XML invalide (conteneur ZIP attendu)."
    elif ext in (".doc", ".xls", ".ppt"):
        if not head.startswith(b"\xd0\xcf\x11\xe0"):
            return "Fichier binaire Microsoft (OLE) attendu."
    return None


@router.post("/extract-document-text")
async def extract_document_text(
    authorization: str | None = Header(default=None, alias="Authorization"),
    file: UploadFile = File(...),
):
    if not authorization or not authorization.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"error": "No authorization header"})

    access_token = authorization.replace("Bearer ", "", 1).strip()
    safe_name = _safe_filename(file.filename)
    ext = Path(safe_name).suffix.lower()
    if ext not in _KNOWLEDGE_EXTENSIONS:
        return JSONResponse(status_code=400, content={"error": "Extension non autorisée"})

    body = await file.read()
    if len(body) > _MAX_BYTES:
        return JSONResponse(status_code=413, content={"error": "Fichier trop volumineux (max 35 Mo)"})

    err = _validate_knowledge_binary(safe_name, body[:32])
    if err:
        return JSONResponse(status_code=400, content={"error": err})

    async with httpx.AsyncClient(timeout=120.0) as client:
        user_id = await get_supabase_user_id(client, access_token)
        if not user_id:
            return JSONResponse(status_code=401, content={"error": "Non authentifié"})

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp.write(body)
            tmp_path = tmp.name

        docs = parse_file(tmp_path)
        text = documents_to_plain_text(docs)
        if not text.strip():
            return JSONResponse(
                status_code=422,
                content={
                    "error": "Aucun texte extractible dans ce fichier. "
                    "Pour les .doc/.ppt, installez antiword et catdoc sur le serveur, "
                    "ou exportez au format Office moderne (.docx / .pptx).",
                },
            )
        return {"text": text}
    except Exception as exc:
        logger.exception("extract-document-text: %s", exc)
        return JSONResponse(status_code=500, content={"error": "Échec de l'extraction"})
    finally:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
