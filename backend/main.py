"""
Point d'entrée de l'application FastAPI (remplacement des Edge Functions Supabase).
Lance avec : cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import admin_user, chat, embed, feedback, health, llm
from config import settings

app = FastAPI(title="Telko API", version="1.0.0")

_origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
if not _origins:
    _origins = ["http://localhost:5173", "http://localhost:8080"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from core.pipeline_instance import get_pipeline, _pipeline


@app.on_event("startup")
async def startup():
    _pipeline.init()

app.include_router(health.router, tags=["health"])
app.include_router(chat.router, tags=["chat"])
app.include_router(embed.router, tags=["embed"])
app.include_router(admin_user.router, tags=["admin"])
app.include_router(llm.router, prefix="/api", tags=["llm"])
app.include_router(feedback.router, prefix="/api", tags=["feedback"])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
