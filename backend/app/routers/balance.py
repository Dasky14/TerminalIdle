"""Game-balance override stub.

The frontend always loads its bundled `balance.json`. When a backend is
configured, it also fetches THIS endpoint and deep-merges the result on top —
so a server can patch balance (or two servers can run different balance) without
redeploying the client.

STUB: for now this returns an empty object, i.e. "no overrides" — the client
keeps its bundled balance. To patch balance from the server, return a partial
(or full) balance object here (e.g. load it from a file or database). Its shape
mirrors DEFAULT_BALANCE in frontend/src/game/balance.js; see docs/BALANCE.md.
Only the keys you include override the client's — everything else is untouched.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/balance", tags=["balance"])


@router.get("")
def get_balance() -> dict:
    # TODO: return balance overrides here (partial or full). Empty = no change.
    return {}
