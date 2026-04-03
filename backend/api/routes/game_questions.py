from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core import game_questions_store

router = APIRouter(prefix="/assistant-game-questions")


class GameQuestionItem(BaseModel):
    icon: str = Field(default="💬", max_length=32)
    text: str = Field(..., min_length=1, max_length=2000)


class GameQuestionsBody(BaseModel):
    items: list[GameQuestionItem] = Field(default_factory=list, max_length=200)


@router.get("/")
async def get_game_questions():
    return game_questions_store.load()


@router.put("/")
async def put_game_questions(body: GameQuestionsBody):
    items = [{"icon": (it.icon.strip() or "💬")[:32], "text": it.text.strip()} for it in body.items]
    try:
        return game_questions_store.save({"items": items})
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Écriture impossible : {e}") from e
