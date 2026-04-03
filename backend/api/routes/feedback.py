from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.feedback_store import get_feedback_store

router = APIRouter(prefix="/feedback")


class FeedbackBody(BaseModel):
    provider: str
    model: str
    prompt: str
    response: str
    # 1 = pouce bas, 2 = pouce haut
    rating: int = Field(..., ge=1, le=2)
    response_time_ms: int | None = None
    cost_estimate_usd: float | None = None
    conversation_id: str | None = None
    user_id: str | None = None


@router.post("/")
async def submit_feedback(body: FeedbackBody):
    store = get_feedback_store()
    feedback_id = store.save(
        provider=body.provider,
        model=body.model,
        prompt=body.prompt,
        response=body.response,
        rating=body.rating,
        response_time_ms=body.response_time_ms,
        cost_estimate_usd=body.cost_estimate_usd,
        conversation_id=body.conversation_id,
        user_id=body.user_id,
    )
    return {"id": feedback_id, "status": "saved"}


@router.get("/")
async def get_feedbacks(limit: int = 100, offset: int = 0):
    store = get_feedback_store()
    return store.get_all(limit=limit, offset=offset)


@router.get("/stats")
async def get_stats():
    store = get_feedback_store()
    return store.get_stats()
