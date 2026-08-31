"""Leaderboard stub.

In-memory, per-minigame high scores. Placeholder for a future feature — no
anti-cheat or persistence yet. Because there are no accounts, a real
implementation would need some lightweight identity/verification scheme.
"""

from fastapi import APIRouter

from app.models import ScoreEntry

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])

# TODO: persist and validate scores. In-memory for now.
_SCORES: list[ScoreEntry] = []


@router.post("")
def submit_score(entry: ScoreEntry) -> dict:
    _SCORES.append(entry)
    return {"ok": True}


@router.get("/{minigame_id}", response_model=list[ScoreEntry])
def top_scores(minigame_id: str, limit: int = 10) -> list[ScoreEntry]:
    scores = [s for s in _SCORES if s.minigame_id == minigame_id]
    scores.sort(key=lambda s: s.score, reverse=True)
    return scores[:limit]
