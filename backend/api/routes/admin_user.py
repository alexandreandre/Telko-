"""
POST /create-admin-user — équivalent Edge Function `create-admin-user`.
Crée un utilisateur Auth + profil / rôles (clé service Supabase).
"""

import json
from typing import Any

import httpx
from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import settings

router = APIRouter()


class CreateAdminBody(BaseModel):
    email: str
    password: str
    name: str | None = None
    role_id: str | None = None
    department: str | None = None
    company_id: str | None = None
    system_role: str | None = "user"


def _service_headers() -> dict[str, str]:
    key = settings.supabase_service_role_key
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


async def _get_user_from_jwt(client: httpx.AsyncClient, token: str) -> dict[str, Any] | None:
    r = await client.get(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
        headers={
            "apikey": settings.supabase_anon_key,
            "Authorization": f"Bearer {token}",
        },
    )
    if r.status_code != 200:
        return None
    return r.json()


async def _user_has_admin_role(client: httpx.AsyncClient, user_id: str) -> bool:
    url = (
        f"{settings.supabase_url.rstrip('/')}/rest/v1/user_roles"
        f"?user_id=eq.{user_id}&select=role"
    )
    r = await client.get(url, headers=_service_headers())
    if r.status_code != 200:
        return False
    rows = r.json()
    if not isinstance(rows, list):
        return False
    return any((r.get("role") == "admin") for r in rows)


@router.post("/create-admin-user")
async def create_admin_user(
    body: CreateAdminBody,
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    async with httpx.AsyncClient(timeout=60.0) as client:
        if authorization and authorization.startswith("Bearer "):
            token = authorization.replace("Bearer ", "", 1).strip()
            caller = await _get_user_from_jwt(client, token)
            if caller and caller.get("id"):
                if not await _user_has_admin_role(client, caller["id"]):
                    return JSONResponse(
                        status_code=403,
                        content={"error": "Non autorisé"},
                    )

        if not body.email or not body.password:
            return JSONResponse(
                status_code=400,
                content={"error": "Email et mot de passe requis"},
            )

        name = body.name or body.email.split("@")[0]
        create_payload = {
            "email": body.email,
            "password": body.password,
            "email_confirm": True,
            "user_metadata": {"name": name},
        }

        r = await client.post(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
            headers=_service_headers(),
            json=create_payload,
        )

        if r.status_code not in (200, 201):
            try:
                err = r.json()
                msg = err.get("msg") or err.get("message") or err.get("error_description") or r.text
            except json.JSONDecodeError:
                msg = r.text
            return JSONResponse(status_code=400, content={"error": str(msg)})

        user_data = r.json()
        new_id = user_data.get("id")
        if not new_id:
            return JSONResponse(
                status_code=500,
                content={"error": "Réponse auth inattendue"},
            )

        system_role = body.system_role or "user"
        if system_role and system_role != "user":
            await client.post(
                f"{settings.supabase_url.rstrip('/')}/rest/v1/user_roles",
                headers=_service_headers(),
                json={"user_id": new_id, "role": system_role},
            )

        updates: dict[str, Any] = {}
        if body.name:
            updates["name"] = body.name
        if body.role_id:
            updates["role_id"] = body.role_id
        if body.department:
            updates["department"] = body.department
        if body.company_id:
            updates["company_id"] = body.company_id

        if updates:
            patch_url = (
                f"{settings.supabase_url.rstrip('/')}/rest/v1/profiles"
                f"?id=eq.{new_id}"
            )
            await client.patch(patch_url, headers=_service_headers(), json=updates)

        return {"success": True, "user_id": new_id}
