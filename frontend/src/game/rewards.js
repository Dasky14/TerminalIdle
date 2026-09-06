// Apply a reward payload (typically from a minigame) to global state.
//
// Reward payload shape (all fields optional):
//   {
//     xp: 10,
//     resources: { scrap: 2, credits: 5 },
//     items: [{ id: 'gear', name: 'Gear', qty: 1 }]
//   }

import { addXp } from './leveling.js';
import { addResources } from './resources.js';
import { addItem } from './inventory.js';
import { generateItem } from './items.js';
import { effectiveStats } from './character.js';

/**
 * Apply a reward and return a summary of what happened (useful for a toast /
 * terminal line).
 * @param {{xp?: number, resources?: object, items?: Array}} reward
 * @param {{ source?: string }} [ctx]  where the reward came from (minigame id)
 */
export function applyReward(reward = {}, ctx = {}) {
  const summary = { xp: 0, levelsGained: 0, resources: {}, items: [], source: ctx.source };

  if (reward.xp) {
    const { levelsGained } = addXp(reward.xp);
    summary.xp = Math.floor(reward.xp) || 0;
    summary.levelsGained = levelsGained;
  }

  if (reward.resources && typeof reward.resources === 'object') {
    addResources(reward.resources);
    summary.resources = { ...reward.resources };
  }

  if (Array.isArray(reward.items)) {
    for (const item of reward.items) {
      if (!item) continue;
      if (item.roll === 'equipment') {
        // Roll a random equipment drop; the player's Luck biases the rarity.
        const gen = generateItem({ luck: effectiveStats().luck || 0 });
        addItem({ id: gen.uid, name: gen.name, qty: 1, meta: gen });
        summary.items.push({ id: gen.uid, name: gen.name, rarity: gen.rarity, qty: 1 });
      } else if (item.id) {
        addItem(item);
        summary.items.push({ id: item.id, name: item.name, qty: item.qty ?? 1 });
      }
    }
  }

  return summary;
}
