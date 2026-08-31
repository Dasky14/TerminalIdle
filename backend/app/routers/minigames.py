"""Minigame registry stub.

Returns a server-side list of minigames. For now it mirrors the frontend's
registry.js; later you might serve this dynamically so new minigames can be
added without redeploying the frontend.
"""

from fastapi import APIRouter

from app.models import MinigameMeta

router = APIRouter(prefix="/minigames", tags=["minigames"])

# TODO: source this from a database or config so it can change at runtime.
_MINIGAMES: list[MinigameMeta] = [
    MinigameMeta(
        id="sample-clicker",
        title="Sample Clicker",
        kind="html",
        entry="minigames/sample-clicker/index.html",
        desc="A tiny demo that grants XP and scrap.",
    ),
]


@router.get("", response_model=list[MinigameMeta])
def list_minigames() -> list[MinigameMeta]:
    return _MINIGAMES
