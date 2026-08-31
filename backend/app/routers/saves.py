"""Cloud-save stub.

In-memory only — restarts lose data. This is a placeholder so the frontend can
optionally sync saves later. Swap the dict for a real store (SQLite, Redis,
Postgres, S3, ...) when you're ready.
"""

from fastapi import APIRouter, HTTPException

from app.models import SaveBlob

router = APIRouter(prefix="/saves", tags=["saves"])

# TODO: replace in-memory storage with a real database.
_STORE: dict[str, dict] = {}


@router.put("/{save_id}")
def put_save(save_id: str, blob: SaveBlob) -> dict:
    """Store (or overwrite) a save blob under a client-generated id."""
    _STORE[save_id] = blob.data
    return {"ok": True, "id": save_id}


@router.get("/{save_id}")
def get_save(save_id: str) -> SaveBlob:
    """Fetch a previously stored save blob."""
    if save_id not in _STORE:
        raise HTTPException(status_code=404, detail="save not found")
    return SaveBlob(id=save_id, data=_STORE[save_id])
