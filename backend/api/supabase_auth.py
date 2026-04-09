"""Vérification du JWT Supabase (utilisateur courant) pour les routes API."""

import httpx

from config import settings


async def get_supabase_user_id(client: httpx.AsyncClient, access_token: str) -> str | None:
    r = await client.get(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
        headers={
            "apikey": settings.supabase_anon_key,
            "Authorization": f"Bearer {access_token}",
        },
    )
    if r.status_code != 200:
        return None
    data = r.json()
    uid = data.get("id")
    return uid if isinstance(uid, str) and uid else None
