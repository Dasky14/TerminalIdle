# Loot & weapon-combat rules

The canonical spec for how weapons deal damage and how weapon loot is rolled.
These rules are meant to be **enforced by generation**, not just hoped for — the
enforcement points are named so they stay in sync.

## Adding items, modifiers & effects (data-driven)

The item **catalogue** is data: [`game/items-data.js`](../frontend/src/game/items-data.js)
(embedded default) and [`public/items.json`](../frontend/public/items.json)
(editable post-build, backend-overridable — same layering as balance). Edit
either to extend the game:

- **A weapon/armour** — add a `bases` entry: `{ key, name, slot, hands?,
  atkType?, stats:{} }`. Weapons use `slot:"weapon"` with `hands` 1/2/`"off"` and
  need `atkType` (`"physical"`|`"magical"`); armour just needs its slot.
- **A modifier** — add an entry to `prefixes`/`suffixes` keyed by an id, with:
  `weight` (its relative chance of being the one rolled, vs others in that pool),
  `names` (one name per tier — the array's length is the modifier's max tier,
  nothing rolls beyond it), and `stats` (the bonus **per tier**; tier N grants
  N× it, and a modifier may grant several stats at once — e.g. `{ critRate: 0.5,
  critDmg: 1 }` at tier 5 gives +2.5% Crit%, +5% CritDmg). Which tier you get is
  a weighted roll biased toward low tiers by `loot.modifierTierFraction` in
  balance (0.5 → tier weights 100/50/25/…). A prefix name goes before the item
  and a suffix after, so the name should read accordingly.
- **A legendary** — add a `legendaries` entry (like a base, plus `effects`).

**Effects** are a registry: `effects` maps an id to `{ desc, value? }`. **Any
item can carry an effect** by listing its id in that item's `effects` array — a
bare id (`"firstHitShield"`) or an object (`{ "id": "ignoreDefense", "value":
0.5 }`) to override the registry value. Base items grant their effects to every
instance they roll; legendaries carry theirs; `itemEffects()` resolves the refs.
The effect's combat *behaviour* is implemented **by id in the dungeon** — reusing
an existing id (`ignoreDefense`, `firstHitShield`, `alwaysFirst`) is a pure data
edit; a brand-new id also needs a combat hook added there.

## Damage type comes from the weapon, not the higher stat

A player attack's damage type is decided by the **equipped weapon**, not by
whichever of P.Att / M.Att is larger:

- **Physical** weapons — swords, daggers, greatswords → use **P.Att**, checked
  against the enemy's **P.Def**.
- **Magical** weapons — wands, staves → use **M.Att**, checked against **M.Def**.

Each attacking weapon carries `atkType: 'physical' | 'magical'`
([`items.js`](../frontend/src/game/items.js) `BASE_ITEMS` / `LEGENDARIES`).
`weaponAtkType(item)` resolves it (falling back for old saves). Enemies have no
weapon, so they keep the "use the stronger of P.Att/M.Att" rule.

## Weapon configuration → attacks per turn

Computed by `combatProfile()` in
[`character.js`](../frontend/src/game/character.js) and sent to combat games over
the bridge (`init.combat` / `stats.combat`). One player turn resolves **all** of
these attacks; the enemy makes one.

| Setup | Attacks per turn | Defense |
| --- | --- | --- |
| Two-handed weapon | one **1.3×** attack, the weapon's type | — |
| Two one-handed weapons | one **0.6×** attack **each**, per that weapon's type | — |
| One-handed weapon (+ optional shield) | one **1.0×** attack, the weapon's type | shield → **1.2×** |
| Off-hand shield only / nothing | one **1.0×** physical (unarmed) attack | shield → **1.2×** |

So a **wand + dagger** does one 0.6× *magical* hit and one 0.6× *physical* hit in
the same turn. Each attack's raw power uses the player's **aggregate** stat for
its type (allocation + equipment + upgrades) × the multiplier.

Damage math (per attack), implemented in the dungeon's `computeAttack`:

```
raw     = (physical ? P.Att : M.Att) * mult
effDef  = baseDef * defenderDefenseMult * (1 - defPen)   // shield / Radiant Edge
damage  = raw * (1 - effDef / (effDef + 50))             // then crits
```

## Weapon loot-stat rules

Enforced in `generateItem()` ([`items.js`](../frontend/src/game/items.js)). When
changing any of these, update this table and that function together.

1. **Two-handed weapons are single-type.** A greatsword never rolls an M.Att
   modifier; a staff never rolls a P.Att modifier. (Enforced by removing the
   opposite attack stat from the modifier pool for 2H weapons.)
2. **Two-handed weapons carry ~2× the extra stats.** A 2H weapon occupies both
   weapon slots, so to keep parity with two one-handed weapons its **modifier
   values are doubled**, and its **base attack is ~2× a one-hander's** (sword/
   wand base 6, greatsword/staff base 12).
3. **One-handed weapons may mix attack types, but the total is conserved.** A 1H
   weapon may roll both P.Att and M.Att modifiers. Because every modifier is
   worth the same (`perPoint × tier`), splitting one across types gives the same
   combined attack as putting it all in one — a dual-type 1H is never a stat
   advantage, only a flexibility one (it can feed a magical *and* a physical
   swing when dual-wielded).

Non-attack stats (HP, defenses, Speed, Acc, Dodge, crit, Luck) are unconstrained
on any weapon.

## Balance intent

- A 2H weapon = 1.3× single hit + ~2× the stats of a 1H, in one slot-pair.
- Dual 1H = 1.2× total (2 × 0.6×) split into two independently-rolled hits,
  from two separately-rolled weapons (more total modifier rolls, each smaller).
- 1H + shield = 1.0× hit but +20% defense — the tanky option.

These are deliberately close so no single setup dominates; retune the multipliers
in `combatProfile()` (and this doc) if the balance drifts.
