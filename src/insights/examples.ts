import type { WeaknessExample } from "@/weakness/queries";

/**
 * Which three positions the coach gets to see.
 *
 * Chosen here rather than by the model: the model explains, it does not
 * discover. Worst, typical and most recent — so the coach sees the full shape
 * of the problem rather than three variations on one disaster, and can say
 * whether it is still happening.
 */

export type ExampleRole = "worst" | "typical" | "recent";

export type SelectedExample = {
  role: ExampleRole;
  example: WeaknessExample;
};

/**
 * Three positions, one per role, each from a different game.
 *
 * The distinct-game rule is the point of the exercise. One catastrophic game
 * is often both the worst case and the most recent, so picking each role
 * independently shows that single game three times and invites the coach to
 * describe one disaster as a recurring pattern.
 *
 * Fewer than three games in the pool yields fewer than three examples rather
 * than repeating one — an honest "this is all the evidence there is".
 */
export function selectExamples(pool: WeaknessExample[]): SelectedExample[] {
  const byCost = [...pool].sort(compareCost);
  const byRecency = [...pool].sort(compareRecency);

  // Ordered by how much each role would lose by being displaced: the worst
  // case and the most recent are specific positions, while "typical" only has
  // to be representative, so it yields to the other two.
  const claims: [ExampleRole, WeaknessExample[]][] = [
    ["worst", byCost],
    ["recent", byRecency],
    ["typical", byCost],
  ];

  const taken = new Set<string>();
  const picked = new Map<ExampleRole, WeaknessExample>();

  for (const [role, ordered] of claims) {
    const available = ordered.filter((e) => !taken.has(e.gameId));
    if (available.length === 0) continue;

    // "Typical" is the middle of what is left by cost; the others are the head
    // of their own ordering.
    const choice =
      role === "typical"
        ? available[Math.floor(available.length / 2)]!
        : available[0]!;

    taken.add(choice.gameId);
    picked.set(role, choice);
  }

  // Presented worst-first regardless of which role claimed its game first.
  const order: ExampleRole[] = ["worst", "typical", "recent"];
  return order.flatMap((role) => {
    const example = picked.get(role);
    return example ? [{ role, example }] : [];
  });
}

/** Costliest first, ties broken by game and ply so the pick is stable. */
function compareCost(a: WeaknessExample, b: WeaknessExample): number {
  return b.winPctLost - a.winPctLost || tiebreak(a, b);
}

/** Latest first, same stable tiebreak. */
function compareRecency(a: WeaknessExample, b: WeaknessExample): number {
  return b.endTime - a.endTime || tiebreak(a, b);
}

/**
 * Without this, two equally costly positions could swap between runs and
 * change the request hash, so a cached explanation would miss for no reason.
 */
function tiebreak(a: WeaknessExample, b: WeaknessExample): number {
  return a.gameId.localeCompare(b.gameId) || a.ply - b.ply;
}
