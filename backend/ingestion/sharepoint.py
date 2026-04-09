"""
Connecteur SharePoint via Microsoft Graph API.
Authentifié avec les credentials Azure AD (client credentials flow).
Liste les fichiers d'un drive SharePoint, télécharge leur contenu
et les transmet au file_parser pour extraction de texte.
"""

import asyncio
import logging
import os
import urllib.parse
from pathlib import Path
from typing import Any

import httpx
from azure.core.exceptions import ClientAuthenticationError
from azure.identity import ClientSecretCredential

from config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_GRAPH_SCOPE = "https://graph.microsoft.com/.default"

# Fichier de persistance du delta token (chemin relatif au dossier ingestion/)
_DELTA_TOKEN_FILE = Path(__file__).parent / ".delta_token"

# Retry
_MAX_RETRIES = 3
_BACKOFF_BASE = 2.0  # secondes (exponentiel : 2s, 4s, 8s)

# Timeout par défaut pour les requêtes Graph (download peut être long)
_DEFAULT_TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=5.0)

# Extensions de fichiers considérées comme "documents" (filtre côté list)
_DOCUMENT_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".txt",
    ".xls",
    ".xlsx",
    ".jpg",
    ".jpeg",
    ".png",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_delta_token(delta_link: str) -> str:
    """
    Extrait la valeur brute du $deltatoken depuis une deltaLink URL.
    Retourne la deltaLink complète si l'extraction échoue (fallback sûr).
    """
    try:
        parsed = urllib.parse.urlparse(delta_link)
        params = urllib.parse.parse_qs(parsed.query)
        return params.get("$deltatoken", [delta_link])[0]
    except Exception:
        return delta_link


def _load_delta_token() -> str | None:
    """Charge le delta token persisté sur disque. Retourne None si absent."""
    try:
        token = _DELTA_TOKEN_FILE.read_text(encoding="utf-8").strip()
        return token or None
    except FileNotFoundError:
        return None
    except Exception as exc:
        logger.warning("Impossible de lire le delta token : %s", exc)
        return None


def _save_delta_token(token: str) -> None:
    """Persiste le delta token sur disque pour la prochaine sync."""
    try:
        _DELTA_TOKEN_FILE.write_text(token, encoding="utf-8")
        logger.debug("Delta token sauvegardé.")
    except Exception as exc:
        logger.warning("Impossible de sauvegarder le delta token : %s", exc)


def _normalize_item(item: dict) -> dict:
    """
    Normalise un item Microsoft Graph en un dict uniforme exploitable
    par le scheduler et le pipeline.

    Clés retournées :
      id, name, size, last_modified, download_url, path, deleted, mime_type
    """
    deleted = "deleted" in item  # Graph retourne {"deleted": {"state": "deleted"}}
    return {
        "id": item.get("id", ""),
        "name": item.get("name", ""),
        "size": item.get("size", 0),
        "last_modified": item.get("lastModifiedDateTime", ""),
        "download_url": item.get("@microsoft.graph.downloadUrl", ""),
        "path": item.get("parentReference", {}).get("path", ""),
        "deleted": deleted,
        "mime_type": item.get("file", {}).get("mimeType", ""),
    }


def _is_supported_file(item: dict) -> bool:
    """
    Retourne True si l'item est un fichier (non dossier) avec une extension
    supportée par le file_parser.
    """
    if "folder" in item:
        return False
    name = item.get("name", "")
    ext = Path(name).suffix.lower()
    return ext in _DOCUMENT_EXTENSIONS


# ---------------------------------------------------------------------------
# SharePointConnector
# ---------------------------------------------------------------------------

class SharePointConnector:
    """
    Connecteur SharePoint via Microsoft Graph API (client credentials OAuth2).

    Authentification :
      - ClientSecretCredential (azure-identity) avec AZURE_TENANT_ID,
        AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.
      - Token renouvelé automatiquement par azure-identity.

    Retry :
      - 3 tentatives avec backoff exponentiel (2s, 4s, 8s) sur les erreurs
        réseau (httpx.NetworkError, httpx.TimeoutException) et les erreurs
        serveur 5xx / 429 (rate limit).
      - Les erreurs 4xx (sauf 429) échouent immédiatement.

    Delta token :
      - Persisté dans .delta_token (relatif au dossier ingestion/).
      - Chargé automatiquement au démarrage, sauvegardé après chaque sync delta.
    """

    def __init__(self) -> None:
        self._credential = ClientSecretCredential(
            tenant_id=settings.azure_tenant_id,
            client_id=settings.azure_client_id,
            client_secret=settings.azure_client_secret,
        )
        self._site_id = settings.sharepoint_site_id
        self._drive_id = settings.sharepoint_drive_id
        self._drive_base = f"{_GRAPH_BASE}/drives/{self._drive_id}"
        logger.info(
            "SharePointConnector initialisé — drive=%s site=%s",
            self._drive_id,
            self._site_id,
        )

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    async def _get_token(self) -> str:
        """
        Retourne un access token valide pour Microsoft Graph.
        azure-identity gère le cache et le renouvellement automatique.
        """
        try:
            token = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._credential.get_token(_GRAPH_SCOPE),
            )
            return token.token
        except ClientAuthenticationError as exc:
            raise RuntimeError(
                "Authentification Azure AD échouée. Vérifiez AZURE_TENANT_ID, "
                "AZURE_CLIENT_ID et AZURE_CLIENT_SECRET."
            ) from exc

    def _auth_headers(self, token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }

    # ------------------------------------------------------------------
    # Retry
    # ------------------------------------------------------------------

    async def _request(
        self,
        method: str,
        url: str,
        *,
        stream: bool = False,
        **kwargs: Any,
    ) -> httpx.Response:
        """
        Exécute une requête HTTP vers Microsoft Graph avec retry automatique.

        Retry sur :
          - httpx.NetworkError, httpx.TimeoutException
          - HTTP 5xx (erreurs serveur)
          - HTTP 429 (rate limit) : respecte le header Retry-After

        Les erreurs HTTP 4xx (sauf 429) échouent immédiatement.

        Args:
            method:  Méthode HTTP ('GET', 'POST', …).
            url:     URL complète de l'endpoint Graph.
            stream:  Si True, retourne la réponse sans lire le body (pour download).
            **kwargs: Arguments httpx supplémentaires (params, json, …).

        Returns:
            httpx.Response avec status code 2xx.

        Raises:
            RuntimeError: Si toutes les tentatives ont échoué.
        """
        token = await self._get_token()
        headers = {**self._auth_headers(token), **kwargs.pop("headers", {})}
        last_exc: Exception | None = None

        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
                    if stream:
                        # Retourné en context manager — appelant doit lire en streaming
                        response = await client.request(method, url, headers=headers, **kwargs)
                    else:
                        response = await client.request(method, url, headers=headers, **kwargs)

                    if response.status_code == 429:
                        retry_after = int(response.headers.get("Retry-After", _BACKOFF_BASE ** attempt))
                        logger.warning(
                            "Rate limit Graph API (429). Attente %ds (tentative %d/%d).",
                            retry_after, attempt, _MAX_RETRIES,
                        )
                        await asyncio.sleep(retry_after)
                        # Renouvelle le token avant de réessayer
                        token = await self._get_token()
                        headers = self._auth_headers(token)
                        continue

                    response.raise_for_status()
                    return response

            except httpx.HTTPStatusError as exc:
                if exc.response.status_code < 500:
                    raise  # 4xx non retryable
                logger.warning(
                    "Erreur serveur HTTP %d (tentative %d/%d) : %s",
                    exc.response.status_code, attempt, _MAX_RETRIES, exc,
                )
                last_exc = exc

            except (httpx.NetworkError, httpx.TimeoutException) as exc:
                logger.warning(
                    "Erreur réseau (tentative %d/%d) : %s",
                    attempt, _MAX_RETRIES, exc,
                )
                last_exc = exc

            if attempt < _MAX_RETRIES:
                wait = _BACKOFF_BASE ** (attempt - 1)  # 1s, 2s, 4s
                logger.info("Nouvelle tentative dans %.0fs…", wait)
                await asyncio.sleep(wait)

        raise RuntimeError(
            f"Toutes les tentatives ont échoué pour {method} {url} : {last_exc}"
        ) from last_exc

    # ------------------------------------------------------------------
    # Pagination interne
    # ------------------------------------------------------------------

    async def _get_all_pages(self, start_url: str) -> tuple[list[dict], str]:
        """
        Suit les pages @odata.nextLink jusqu'à épuisement.

        Returns:
            (items, delta_link) — delta_link est vide si absent de la réponse
            (ex : requête /children sans delta).
        """
        items: list[dict] = []
        url: str | None = start_url
        delta_link = ""

        while url:
            response = await self._request("GET", url)
            data = response.json()

            items.extend(data.get("value", []))

            next_link = data.get("@odata.nextLink")
            delta_link = data.get("@odata.deltaLink", delta_link)

            url = next_link  # None quand on atteint la dernière page

        return items, delta_link

    # ------------------------------------------------------------------
    # API publique
    # ------------------------------------------------------------------

    async def list_all_files(self) -> list[dict]:
        """
        Liste tous les fichiers supportés du drive SharePoint.

        Utilise l'endpoint /delta (sans token) pour parcourir l'intégralité
        du drive de manière récursive et efficace. Les dossiers et les formats
        non supportés sont filtrés.

        Returns:
            Liste de dicts normalisés : {id, name, size, last_modified,
            download_url, path, deleted, mime_type}.

        Raises:
            RuntimeError: Si l'authentification ou la requête échoue.
        """
        logger.info("list_all_files() — parcours complet du drive '%s'…", self._drive_id)
        url = f"{self._drive_base}/root/delta"

        raw_items, delta_link = await self._get_all_pages(url)

        # Sauvegarde le delta token pour les syncs suivantes
        if delta_link:
            token = _extract_delta_token(delta_link)
            _save_delta_token(token)

        files = [_normalize_item(i) for i in raw_items if _is_supported_file(i)]
        logger.info(
            "list_all_files() → %d fichier(s) trouvé(s) (sur %d items total).",
            len(files),
            len(raw_items),
        )
        return files

    async def get_changed_files(
        self,
        delta_token: str | None = None,
    ) -> tuple[list[dict], str]:
        """
        Récupère les fichiers ajoutés, modifiés ou supprimés depuis la dernière sync.

        Utilise l'endpoint /delta de Microsoft Graph avec le delta token persisté.
        Si aucun token n'est disponible (première exécution), effectue un parcours
        complet et retourne tous les fichiers.

        Le nouveau delta token est automatiquement sauvegardé dans .delta_token.

        Args:
            delta_token: Token delta explicite (prioritaire sur le token persisté).
                         Passer None pour utiliser le token stocké sur disque.

        Returns:
            Tuple (changed_files, new_delta_token) où :
              - changed_files : liste de dicts normalisés (deleted=True si supprimé)
              - new_delta_token : token à passer au prochain appel (déjà persisté)

        Raises:
            RuntimeError: Si l'authentification ou la requête échoue.
        """
        # Résolution du token : argument > disque > None (full scan)
        token = delta_token or _load_delta_token()

        if token:
            # Construction de la deltaLink complète si on reçoit juste le token
            if token.startswith("http"):
                url = token  # token est déjà une deltaLink complète
            else:
                url = f"{self._drive_base}/root/delta?$deltatoken={urllib.parse.quote(token)}"
            logger.info("get_changed_files() — utilisation du delta token existant.")
        else:
            url = f"{self._drive_base}/root/delta"
            logger.info(
                "get_changed_files() — aucun delta token, scan complet initial."
            )

        raw_items, delta_link = await self._get_all_pages(url)

        new_token = ""
        if delta_link:
            new_token = _extract_delta_token(delta_link)
            _save_delta_token(new_token)

        # Sépare ajouts/modifs et suppressions pour le log
        deleted = [i for i in raw_items if "deleted" in i]
        changed = [i for i in raw_items if "deleted" not in i and _is_supported_file(i)]

        if deleted:
            for item in deleted:
                logger.info("Fichier supprimé dans SharePoint : '%s' (id=%s).", item.get("name"), item.get("id"))

        if changed:
            for item in changed:
                logger.info(
                    "Fichier modifié/ajouté : '%s' (id=%s, modifié=%s).",
                    item.get("name"),
                    item.get("id"),
                    item.get("lastModifiedDateTime", "?"),
                )

        normalized = [_normalize_item(i) for i in (changed + deleted)]
        logger.info(
            "get_changed_files() → %d changement(s) : %d modifié(s), %d supprimé(s).",
            len(normalized),
            len(changed),
            len(deleted),
        )
        return normalized, new_token

    async def download_file(self, item_id: str, local_path: str) -> str:
        """
        Télécharge un fichier depuis SharePoint et le sauvegarde localement.

        Utilise l'URL de téléchargement pré-authentifiée de Microsoft Graph.
        Le fichier est streamé par blocs de 8 Ko pour éviter la saturation mémoire.

        Args:
            item_id:    Identifiant de l'item Microsoft Graph.
            local_path: Chemin local (absolu ou relatif) où sauvegarder le fichier.

        Returns:
            local_path (str) — chemin du fichier téléchargé.

        Raises:
            RuntimeError: Si le téléchargement échoue après 3 tentatives.
        """
        # Récupère d'abord l'URL de téléchargement pré-authentifiée
        meta_url = f"{self._drive_base}/items/{item_id}"
        meta_resp = await self._request("GET", meta_url, params={"select": "name,@microsoft.graph.downloadUrl"})
        meta = meta_resp.json()

        filename = meta.get("name", item_id)
        download_url = meta.get("@microsoft.graph.downloadUrl")

        if not download_url:
            raise RuntimeError(
                f"Impossible d'obtenir l'URL de téléchargement pour l'item '{item_id}'. "
                "Vérifiez que le fichier existe et que les permissions sont correctes."
            )

        # Crée les dossiers parents si nécessaire
        dest = Path(local_path)
        dest.parent.mkdir(parents=True, exist_ok=True)

        logger.info("Téléchargement de '%s' → '%s'…", filename, local_path)

        # Téléchargement en streaming (URL pré-auth, pas besoin du token Graph)
        last_exc: Exception | None = None
        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
                    async with client.stream("GET", download_url) as response:
                        response.raise_for_status()
                        with dest.open("wb") as f:
                            async for chunk in response.aiter_bytes(chunk_size=8192):
                                f.write(chunk)

                file_size = dest.stat().st_size
                logger.info(
                    "Téléchargé : '%s' → '%s' (%.1f Ko).",
                    filename,
                    local_path,
                    file_size / 1024,
                )
                return local_path

            except (httpx.NetworkError, httpx.TimeoutException) as exc:
                logger.warning(
                    "Erreur réseau téléchargement '%s' (tentative %d/%d) : %s",
                    filename, attempt, _MAX_RETRIES, exc,
                )
                last_exc = exc
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(_BACKOFF_BASE ** (attempt - 1))

            except httpx.HTTPStatusError as exc:
                # L'URL pré-auth peut expirer (410 Gone) : on la renouvelle
                if exc.response.status_code in (410, 403):
                    logger.warning(
                        "URL de téléchargement expirée pour '%s', renouvellement…",
                        filename,
                    )
                    meta_resp = await self._request(
                        "GET", meta_url, params={"select": "@microsoft.graph.downloadUrl"}
                    )
                    download_url = meta_resp.json().get("@microsoft.graph.downloadUrl", "")
                    last_exc = exc
                    continue
                raise

        raise RuntimeError(
            f"Téléchargement de '{filename}' échoué après {_MAX_RETRIES} tentatives."
        ) from last_exc

    async def get_user_accessible_files(self, user_id: str) -> list[str]:
        """
        Retourne les IDs des fichiers auxquels l'utilisateur a accès dans le drive.

        Stratégie : pour chaque fichier du drive, interroge l'endpoint /permissions
        et vérifie si l'utilisateur (par son user_id ou son email) apparaît dans
        les grants. Les fichiers sans restriction explicite sont considérés accessibles
        (héritage du site SharePoint).

        Note : cette méthode est coûteuse en appels Graph (1 requête par fichier).
        En production, préférer une stratégie basée sur les groupes Azure AD ou
        l'indexation des permissions à l'ingestion.

        Args:
            user_id: ID Azure AD de l'utilisateur (format GUID).

        Returns:
            Liste des item IDs accessibles par l'utilisateur.

        Raises:
            RuntimeError: Si l'authentification ou la requête échoue.
        """
        logger.info("get_user_accessible_files() — vérification pour user_id='%s'.", user_id)

        all_files = await self.list_all_files()
        if not all_files:
            return []

        accessible_ids: list[str] = []

        for file_info in all_files:
            item_id = file_info["id"]
            filename = file_info["name"]

            try:
                perms_url = f"{self._drive_base}/items/{item_id}/permissions"
                resp = await self._request("GET", perms_url)
                permissions: list[dict] = resp.json().get("value", [])

                # Si aucune permission explicite → héritage du site (accessible)
                if not permissions:
                    accessible_ids.append(item_id)
                    continue

                user_has_access = False
                for perm in permissions:
                    # Permission directe sur un utilisateur
                    granted_to = perm.get("grantedTo", {})
                    if granted_to:
                        user_info = granted_to.get("user", {})
                        if (
                            user_info.get("id") == user_id
                            or user_info.get("email", "").lower() == user_id.lower()
                        ):
                            user_has_access = True
                            break

                    # Permission via un groupe ou lien de partage (accessible à tous)
                    granted_to_identities = perm.get("grantedToIdentities", [])
                    for identity in granted_to_identities:
                        ui = identity.get("user", {})
                        if (
                            ui.get("id") == user_id
                            or ui.get("email", "").lower() == user_id.lower()
                        ):
                            user_has_access = True
                            break

                    # Lien de type "organization" → accessible à tous les membres
                    link = perm.get("link", {})
                    if link.get("scope") in ("organization", "anonymous"):
                        user_has_access = True
                        break

                if user_has_access:
                    accessible_ids.append(item_id)
                    logger.debug("Accès confirmé pour '%s' (user=%s).", filename, user_id)
                else:
                    logger.debug("Accès refusé pour '%s' (user=%s).", filename, user_id)

            except Exception as exc:
                logger.warning(
                    "Impossible de vérifier les permissions de '%s' : %s. Fichier ignoré.",
                    filename, exc,
                )

        logger.info(
            "get_user_accessible_files() → %d/%d fichier(s) accessibles pour user='%s'.",
            len(accessible_ids),
            len(all_files),
            user_id,
        )
        return accessible_ids


# ---------------------------------------------------------------------------
# Tests basiques — exécuter avec : python ingestion/sharepoint.py
# Nécessite des credentials Azure AD valides dans .env
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import os
    import sys
    import tempfile
    from unittest.mock import AsyncMock, MagicMock, patch

    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    # ---------------------------------------------------------------------------
    # Fixtures Graph API
    # ---------------------------------------------------------------------------
    _MOCK_ITEMS = [
        {
            "id": "item-001",
            "name": "rapport_annuel.pdf",
            "size": 204800,
            "lastModifiedDateTime": "2026-03-15T10:00:00Z",
            "@microsoft.graph.downloadUrl": "https://example.com/download/rapport_annuel.pdf",
            "parentReference": {"path": "/drives/DRIVE/root:/Documents"},
            "file": {"mimeType": "application/pdf"},
        },
        {
            "id": "item-002",
            "name": "guide_onboarding.docx",
            "size": 51200,
            "lastModifiedDateTime": "2026-03-10T08:30:00Z",
            "@microsoft.graph.downloadUrl": "https://example.com/download/guide_onboarding.docx",
            "parentReference": {"path": "/drives/DRIVE/root:/RH"},
            "file": {"mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
        },
        {
            "id": "folder-001",
            "name": "Archives",
            "folder": {"childCount": 5},
            "parentReference": {"path": "/drives/DRIVE/root:"},
        },
    ]

    _MOCK_DELTA_RESPONSE = {
        "value": _MOCK_ITEMS,
        "@odata.deltaLink": (
            "https://graph.microsoft.com/v1.0/drives/DRIVE/root/delta"
            "?$deltatoken=abc123xyz"
        ),
    }

    _MOCK_DELTA_CHANGES = {
        "value": [
            {
                "id": "item-001",
                "name": "rapport_annuel.pdf",
                "size": 210000,
                "lastModifiedDateTime": "2026-03-20T09:00:00Z",
                "@microsoft.graph.downloadUrl": "https://example.com/download/rapport_annuel_v2.pdf",
                "parentReference": {"path": "/drives/DRIVE/root:/Documents"},
                "file": {"mimeType": "application/pdf"},
            },
            {
                "id": "item-003",
                "name": "note_interne.txt",
                "deleted": {"state": "deleted"},
                "parentReference": {"path": "/drives/DRIVE/root:"},
            },
        ],
        "@odata.deltaLink": (
            "https://graph.microsoft.com/v1.0/drives/DRIVE/root/delta"
            "?$deltatoken=def456uvw"
        ),
    }

    async def _make_connector_with_mock(response_data: dict) -> SharePointConnector:
        """Crée un connecteur avec un _request mocké."""
        connector = SharePointConnector.__new__(SharePointConnector)
        connector._drive_id = "DRIVE"
        connector._site_id = "SITE"
        connector._drive_base = f"{_GRAPH_BASE}/drives/DRIVE"
        mock_resp = MagicMock()
        mock_resp.json.return_value = response_data
        mock_resp.status_code = 200
        connector._request = AsyncMock(return_value=mock_resp)
        connector._get_token = AsyncMock(return_value="fake-token")
        return connector

    async def test_list_all_files() -> None:
        print("\n=== TEST list_all_files() ===")
        # Supprime le delta token de test éventuel
        if _DELTA_TOKEN_FILE.exists():
            _DELTA_TOKEN_FILE.unlink()

        connector = await _make_connector_with_mock(_MOCK_DELTA_RESPONSE)
        files = await connector.list_all_files()

        # 2 fichiers supportés (rapport PDF + guide DOCX), 1 dossier ignoré
        assert len(files) == 2, f"Attendu 2 fichiers, obtenu {len(files)}"
        names = [f["name"] for f in files]
        assert "rapport_annuel.pdf" in names
        assert "guide_onboarding.docx" in names
        assert "Archives" not in names, "Les dossiers ne doivent pas apparaître"

        for f in files:
            for key in ("id", "name", "size", "last_modified", "download_url", "path", "deleted", "mime_type"):
                assert key in f, f"Clé manquante : '{key}'"

        # Vérifie que le delta token a été sauvegardé
        assert _DELTA_TOKEN_FILE.exists(), "Le delta token doit être sauvegardé sur disque"
        saved_token = _DELTA_TOKEN_FILE.read_text()
        assert saved_token == "abc123xyz", f"Token inattendu : '{saved_token}'"

        print(f"  {len(files)} fichier(s) listés : {names}")
        print(f"  Delta token sauvegardé : '{saved_token}'")
        print("OK")

    async def test_get_changed_files_with_token() -> None:
        print("\n=== TEST get_changed_files() — avec token existant ===")
        _DELTA_TOKEN_FILE.write_text("abc123xyz")

        connector = await _make_connector_with_mock(_MOCK_DELTA_CHANGES)
        changed, new_token = await connector.get_changed_files()

        # 1 modifié (.pdf supporté) + 1 supprimé
        assert len(changed) == 2, f"Attendu 2 changements, obtenu {len(changed)}"
        deleted = [f for f in changed if f["deleted"]]
        modified = [f for f in changed if not f["deleted"]]
        assert len(deleted) == 1
        assert len(modified) == 1
        assert modified[0]["name"] == "rapport_annuel.pdf"
        assert new_token == "def456uvw"

        print(f"  Modifiés : {[f['name'] for f in modified]}")
        print(f"  Supprimés : {[f['name'] for f in deleted]}")
        print(f"  Nouveau token : {new_token}")
        print("OK")

    async def test_get_changed_files_no_token() -> None:
        print("\n=== TEST get_changed_files() — sans token (scan complet) ===")
        if _DELTA_TOKEN_FILE.exists():
            _DELTA_TOKEN_FILE.unlink()

        connector = await _make_connector_with_mock(_MOCK_DELTA_RESPONSE)
        changed, token = await connector.get_changed_files()

        # Sans token → scan complet, retourne tous les fichiers supportés
        assert len(changed) == 2
        assert token == "abc123xyz"
        print(f"  Scan complet : {len(changed)} fichier(s), token='{token}'")
        print("OK")

    async def test_delta_token_persistence() -> None:
        print("\n=== TEST persistance du delta token ===")
        test_token = "persistence-test-token-9999"
        _save_delta_token(test_token)
        loaded = _load_delta_token()
        assert loaded == test_token, f"Attendu '{test_token}', obtenu '{loaded}'"
        _DELTA_TOKEN_FILE.unlink()
        assert _load_delta_token() is None, "Doit retourner None si fichier absent"
        print("OK")

    async def test_normalize_item() -> None:
        print("\n=== TEST _normalize_item() ===")
        raw = _MOCK_ITEMS[0]
        norm = _normalize_item(raw)
        assert norm["id"] == "item-001"
        assert norm["name"] == "rapport_annuel.pdf"
        assert norm["deleted"] is False
        assert norm["mime_type"] == "application/pdf"
        assert "download_url" in norm
        print(f"  Item normalisé : {norm}")
        print("OK")

    async def test_normalize_deleted_item() -> None:
        print("\n=== TEST _normalize_item() — item supprimé ===")
        deleted_item = {"id": "item-X", "name": "old_file.pdf", "deleted": {"state": "deleted"}}
        norm = _normalize_item(deleted_item)
        assert norm["deleted"] is True
        print("OK")

    async def test_is_supported_file() -> None:
        print("\n=== TEST _is_supported_file() ===")
        assert _is_supported_file({"name": "doc.pdf", "file": {}}) is True
        assert _is_supported_file({"name": "doc.docx", "file": {}}) is True
        assert _is_supported_file({"name": "data.csv", "file": {}}) is False
        assert _is_supported_file({"name": "folder", "folder": {"childCount": 3}}) is False
        print("OK")

    async def test_download_file() -> None:
        print("\n=== TEST download_file() ===")
        with tempfile.TemporaryDirectory() as tmpdir:
            dest = os.path.join(tmpdir, "rapport.pdf")

            connector = SharePointConnector.__new__(SharePointConnector)
            connector._drive_id = "DRIVE"
            connector._drive_base = f"{_GRAPH_BASE}/drives/DRIVE"
            connector._get_token = AsyncMock(return_value="fake-token")

            # Mock _request pour les métadonnées
            meta_mock = MagicMock()
            meta_mock.json.return_value = {
                "name": "rapport.pdf",
                "@microsoft.graph.downloadUrl": "https://example.com/fake-dl",
            }
            connector._request = AsyncMock(return_value=meta_mock)

            # Mock httpx.AsyncClient pour le streaming
            fake_content = b"%PDF-1.4 fake content for testing"
            async def fake_stream_chunks(*args, **kwargs):
                yield fake_content

            mock_stream_resp = AsyncMock()
            mock_stream_resp.raise_for_status = MagicMock()
            mock_stream_resp.aiter_bytes = fake_stream_chunks
            mock_stream_resp.__aenter__ = AsyncMock(return_value=mock_stream_resp)
            mock_stream_resp.__aexit__ = AsyncMock(return_value=None)

            mock_client = AsyncMock()
            mock_client.stream = MagicMock(return_value=mock_stream_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)

            with patch("httpx.AsyncClient", return_value=mock_client):
                result = await connector.download_file("item-001", dest)

            assert result == dest
            assert Path(dest).exists()
            assert Path(dest).read_bytes() == fake_content
            print(f"  Fichier téléchargé : {dest} ({len(fake_content)} octets)")
        print("OK")

    async def run_all() -> None:
        await test_list_all_files()
        await test_get_changed_files_with_token()
        await test_get_changed_files_no_token()
        await test_delta_token_persistence()
        await test_normalize_item()
        await test_normalize_deleted_item()
        await test_is_supported_file()
        await test_download_file()
        # Nettoyage
        if _DELTA_TOKEN_FILE.exists():
            _DELTA_TOKEN_FILE.unlink()
        print("\nTous les tests sont passés.")

    asyncio.run(run_all())
