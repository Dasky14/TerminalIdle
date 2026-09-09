# Loot & weapon-combat rules

The canonical spec for how weapons deal damage and how weapon loot is rolled.
These rules are meant to be **enforced by generation**, not just hoped for — the
enforcement points are named so they stay in sync.

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
