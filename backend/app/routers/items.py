"""Item-catalogue override stub.

Companion to the balance override (see balance.py). The frontend always loads
its bundled `items.json`; when a backend is configured it also fetches THIS
endpoint and deep-merges the result on top — so a server can add/patch items
(weapons, modifiers, legendaries, effects) without redeploying the client.

STUB: returns an empty object (no overrides) for now. To serve a catalogue,
return a partial (or full) object whose shape mirrors DEFAULT_ITEMS in
frontend/src/game/items-data.js; see docs/LOOT_RULES.md. Arrays (bases,
legendaries) replace wholesale, objects (prefixes, suffixes, effects) merge.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/items", tags=["items"])


@router.get("")
def get_items() -> dict:
    # TODO: return item-catalogue overrides here (partial or full). Empty = none.
    return {}
