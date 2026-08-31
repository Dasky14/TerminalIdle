"""Pydantic models shared by the API routers.

These mirror the frontend's save shape loosely; the backend treats the save blob
as opaque JSON for now (the client owns the schema — see docs/SAVE_FORMAT.md).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SaveBlob(BaseModel):
    """An opaque client save, stored/retrieved by a client-generated id."""

    id: str = Field(..., description="Client-generated save id (e.g. a UUID).")
    data: dict[str, Any] = Field(..., description="The full save JSON from the client.")


class RewardEvent(BaseModel):
    """A reward a minigame reported — for future server-side validation/telemetry."""

    minigame_id: str
    xp: int = 0
    resources: dict[str, int] = Field(default_factory=dict)
    items: list[dict[str, Any]] = Field(default_factory=list)


class MinigameMeta(BaseModel):
    """Server-side view of a minigame (mirrors frontend registry.js)."""

    id: str
    title: str
    kind: str = "html"
    entry: str
    desc: str | None = None


class ScoreEntry(BaseModel):
    minigame_id: str
    name: str = "anon"
    score: int
