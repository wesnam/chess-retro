import { describe, it, expect } from "vitest";
import {
  MIN_GAMES,
  MIN_OPPORTUNITIES,
  SHRINKAGE_PRIOR,
  rankWeaknesses,
  scoreCandidate,
  type WeaknessCandidate,
} from "./score";

/**
 * The ranking is the part that decides whether this project is any good.
 * Sorting by failure count surfaces whatever is most common rather than what
 * costs the most, so these tests pin the four behaviours the design depends
 * on: exposure gating, shrinkage, severity outweighing frequency, and damping
 * so one catastrophic game cannot dominate.
 */

function candidate(over: Partial<WeaknessCandidate> = {}): WeaknessCandidate {
  const base = {
    dimension: "motif" as const,
    key: "fork",
    label: "Forks",
    opportunities: 100,
    failures: 20,
    winPctLost: 100,
    games: 10,
    ...over,
  };
  return {
    ...base,
    // Defaults to the failure cost — the case for every dimension that
    // partitions moves. A motif overrides it explicitly.
    winPctLostAcrossAll: over.winPctLostAcrossAll ?? base.winPctLost,
  };
}

describe("scoreCandidate", () => {
  it("scores a candidate that bleeds more win probability per chance higher", () => {
    const mild = scoreCandidate(
      candidate({ winPctLost: 50 }),
      { baselineSeverity: 0.5 },
    );
    const severe = scoreCandidate(
      candidate({ winPctLost: 300 }),
      { baselineSeverity: 0.5 },
    );

    expect(severe.score).toBeGreaterThan(mild.score);
  });

  it("gives no score to a candidate at the player's own baseline", () => {
    // Lift is measured against the person's own average, not an absolute
    // standard: a weakness is what they do WORSE than they usually do.
    const scored = scoreCandidate(
      candidate({ opportunities: 100, winPctLost: 100 }),
      { baselineSeverity: 1 },
    );

    expect(scored.severity).toBe(1);
    expect(scored.lift).toBe(1);
    expect(scored.score).toBe(0);
  });

  it("measures severity over the whole slice, not over failures alone", () => {
    // A motif's cost accrues only on the plies it was missed, while every ply
    // it appeared on counts as an opportunity. Dividing the partial cost by
    // the full exposure made tactics structurally unable to rank: on the real
    // corpus `hangingPiece` scored 1.78 against a 5.62 baseline because 397 of
    // its 437 sightings cost nothing and still sat in the denominator.
    const scored = scoreCandidate(
      candidate({
        opportunities: 400,
        failures: 40,
        winPctLost: 780,
        winPctLostAcrossAll: 2400,
      }),
      { baselineSeverity: 5 },
    );

    // 2400/400, not 780/400.
    expect(scored.severity).toBeCloseTo(6, 6);
    expect(scored.lift).toBeGreaterThan(1);
  });

  it("still reports the failure cost, which is what the card shows", () => {
    const scored = scoreCandidate(
      candidate({ winPctLost: 780, winPctLostAcrossAll: 2400 }),
      { baselineSeverity: 5 },
    );

    expect(scored.winPctLost).toBe(780);
  });

  it("reports the failure rate against opportunities, not against failures", () => {
    const scored = scoreCandidate(
      candidate({ opportunities: 80, failures: 20 }),
      { baselineSeverity: 1 },
    );

    expect(scored.failureRate).toBeCloseTo(0.25, 10);
  });

  it("never scores a candidate better than baseline above zero", () => {
    // Doing something BETTER than your own average is not a weakness. Without
    // the floor a negative lift multiplied by a negative would reappear as a
    // positive score on some inputs.
    const scored = scoreCandidate(
      candidate({ winPctLost: 10 }),
      { baselineSeverity: 5 },
    );

    expect(scored.lift).toBeLessThan(1);
    expect(scored.score).toBe(0);
  });

  it("treats zero opportunities as unscoreable rather than dividing by zero", () => {
    const scored = scoreCandidate(
      candidate({ opportunities: 0, failures: 0, winPctLost: 0 }),
      { baselineSeverity: 1 },
    );

    expect(Number.isFinite(scored.score)).toBe(true);
    expect(scored.score).toBe(0);
  });
});

describe("shrinkage", () => {
  it("shrinks a small sample below a large one of equal severity", () => {
    // "2 missed out of 3 chances" must not outrank "40 out of 200". Both have
    // identical observed severity, so only the weight of evidence separates
    // them — and the small sample's lift is pulled toward the baseline.
    const perOpportunity = 10;
    const small = scoreCandidate(
      candidate({ opportunities: 10, winPctLost: 10 * perOpportunity }),
      { baselineSeverity: 1 },
    );
    const large = scoreCandidate(
      candidate({ opportunities: 200, winPctLost: 200 * perOpportunity }),
      { baselineSeverity: 1 },
    );

    expect(small.severity).toBeCloseTo(large.severity, 10);
    expect(small.confidence).toBeLessThan(large.confidence);
    expect(small.lift).toBeLessThan(large.lift);
    expect(small.score).toBeLessThan(large.score);
  });

  it("puts confidence at one half exactly at the prior", () => {
    const scored = scoreCandidate(
      candidate({ opportunities: SHRINKAGE_PRIOR }),
      { baselineSeverity: 1 },
    );

    expect(scored.confidence).toBeCloseTo(0.5, 10);
  });

  it("approaches full confidence as evidence grows without exceeding it", () => {
    const scored = scoreCandidate(
      candidate({ opportunities: 100_000 }),
      { baselineSeverity: 1 },
    );

    expect(scored.confidence).toBeGreaterThan(0.99);
    expect(scored.confidence).toBeLessThan(1);
  });
});

describe("rankWeaknesses", () => {
  it("excludes candidates below the minimum exposure entirely", () => {
    // Being told to fix something seen three times is worse than being told
    // nothing: the rate is noise presented as a finding.
    const ranked = rankWeaknesses(
      [
        candidate({ key: "thin", opportunities: MIN_OPPORTUNITIES - 1, winPctLost: 900 }),
        candidate({ key: "solid", opportunities: 50, winPctLost: 100 }),
      ],
      { baselineSeverity: 1 },
    );

    expect(ranked.map((r) => r.key)).toEqual(["solid"]);
  });

  it("admits a candidate exactly at the minimum exposure", () => {
    const ranked = rankWeaknesses(
      [candidate({ key: "borderline", opportunities: MIN_OPPORTUNITIES, winPctLost: 400 })],
      { baselineSeverity: 1 },
    );

    expect(ranked.map((r) => r.key)).toEqual(["borderline"]);
  });

  it("scores a lone candidate on its own merits, not against itself", () => {
    // With a pooled baseline a single candidate is its own average and always
    // scores zero, so the dashboard would show nothing whenever exactly one
    // weakness cleared the exposure bar.
    const ranked = rankWeaknesses(
      [candidate({ key: "only", opportunities: 60, winPctLost: 600 })],
      { baselineSeverity: 1 },
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.score).toBeGreaterThan(0);
  });

  it("ranks rare-but-severe above frequent-but-trivial", () => {
    // The headline behaviour of the whole design. The trivial candidate is
    // seen six times as often and still must not win — but the severe one has
    // enough evidence to be believed, which is what separates this from the
    // one-blowup case above.
    const ranked = rankWeaknesses(
      [
        candidate({
          key: "frequent-trivial",
          opportunities: 300,
          failures: 150,
          winPctLost: 900,
        }),
        candidate({
          key: "rare-severe",
          opportunities: 50,
          failures: 40,
          winPctLost: 900,
        }),
      ],
      { baselineSeverity: 3 },
    );

    expect(ranked[0]?.key).toBe("rare-severe");
  });

  it("excludes a weakness confined to too few games, however many moves", () => {
    // The protection that matters most in practice. One game supplies dozens
    // of moves, so a move-count threshold alone lets a single disastrous game
    // rank first — on the real corpus every opening family came from exactly
    // one game and outranked motifs seen across the whole set.
    const ranked = rankWeaknesses(
      [
        candidate({
          key: "one-bad-game",
          games: 1,
          opportunities: 60,
          failures: 20,
          winPctLost: 900,
        }),
        candidate({
          key: "across-games",
          games: 8,
          opportunities: 60,
          failures: 12,
          winPctLost: 400,
        }),
      ],
      { baselineSeverity: 3 },
    );

    expect(ranked.map((r) => r.key)).toEqual(["across-games"]);
  });

  it("admits a candidate exactly at the minimum game count", () => {
    const ranked = rankWeaknesses(
      [candidate({ key: "borderline", games: MIN_GAMES, winPctLost: 600 })],
      { baselineSeverity: 1 },
    );

    expect(ranked.map((r) => r.key)).toEqual(["borderline"]);
  });

  it("stops one catastrophic game from reaching the ranking at all", () => {
    // The protection against a single disaster is the exposure gate, not the
    // score. A theme that arose three times and went badly every time has no
    // evidence of being a *pattern*, so it is excluded outright rather than
    // ranked — being told to drill something seen three times is worse than
    // being told nothing.
    //
    // Severities here are what the real corpus produces: a baseline near 3
    // win-probability points per move and a worst case near 35, one whole
    // blunder every time the theme arises.
    const ranked = rankWeaknesses(
      [
        candidate({ key: "one-blowup", opportunities: 3, failures: 3, winPctLost: 105 }),
        candidate({ key: "steady-leak", opportunities: 200, failures: 80, winPctLost: 1000 }),
      ],
      { baselineSeverity: 3 },
    );

    expect(ranked.map((r) => r.key)).toEqual(["steady-leak"]);
  });

  it("shrinks a barely-eligible severe candidate toward the baseline", () => {
    // Above the gate but still thin, a candidate is believed only partly: its
    // reported lift must sit well below the raw ratio its numbers suggest, so
    // that evidence keeps mattering either side of the threshold.
    const [thin] = rankWeaknesses(
      [candidate({ key: "thin", opportunities: MIN_OPPORTUNITIES, winPctLost: 280 })],
      { baselineSeverity: 3 },
    );

    // Raw severity is 35, nearly 12x the baseline.
    expect(thin!.severity).toBeCloseTo(35, 6);
    // Shrunk, it is reported as a far more modest multiple.
    expect(thin!.lift).toBeLessThan(4);
  });

  it("damps total cost logarithmically rather than linearly", () => {
    // Holding opportunities fixed so only the total moves: a hundredfold
    // larger total must not multiply the score a hundredfold. Severity rises
    // with it by design; what must not happen is the two compounding into a
    // runaway, so the score grows far slower than the product would suggest.
    // Baseline below both, so each has real headroom and neither scores zero
    // merely by sitting exactly at the player's own average.
    const modest = scoreCandidate(
      candidate({ opportunities: 100, winPctLost: 100 }),
      { baselineSeverity: 0.5 },
    );
    const enormous = scoreCandidate(
      candidate({ opportunities: 100, winPctLost: 10_000 }),
      { baselineSeverity: 0.5 },
    );

    // Severity is 100x larger, so an undamped total would compound with it.
    expect(enormous.severity / modest.severity).toBeCloseTo(100, 6);
    // The log term must keep the cost factor near 2x, not near 100x.
    const costFactor = Math.log1p(10_000) / Math.log1p(100);
    expect(costFactor).toBeLessThan(2.1);
    // So the score grows by roughly lift, not by lift times the raw total.
    expect(enormous.score).toBeLessThan(modest.score * 100 * 2.1);
  });

  it("ranks every dimension against every other in one pool", () => {
    // A time-management weakness and a tactical one must be comparable, or
    // the dashboard can only ever show the worst of each kind.
    const ranked = rankWeaknesses(
      [
        candidate({ dimension: "motif", key: "fork", opportunities: 60, winPctLost: 200 }),
        candidate({ dimension: "time", key: "scramble", opportunities: 60, winPctLost: 900 }),
        candidate({ dimension: "phase", key: "endgame", opportunities: 60, winPctLost: 500 }),
      ],
      { baselineSeverity: 1 },
    );

    expect(ranked.map((r) => r.dimension)).toEqual(["time", "phase", "motif"]);
  });

  it("measures lift against the supplied corpus baseline", () => {
    // Baseline is the player's own cost per move across the whole corpus, so
    // "worse than usual for me" is the question being asked. A candidate at
    // that baseline is not a weakness however large its raw numbers.
    const ranked = rankWeaknesses(
      [
        candidate({ key: "typical", opportunities: 100, winPctLost: 200 }),
        candidate({ key: "worse", opportunities: 100, winPctLost: 600 }),
      ],
      { baselineSeverity: 2 },
    );

    expect(ranked.map((r) => r.key)).toEqual(["worse"]);
  });

  it("falls back to the pooled mean when no baseline is supplied", () => {
    const ranked = rankWeaknesses([
      candidate({ key: "a", opportunities: 100, winPctLost: 100 }),
      candidate({ key: "b", opportunities: 100, winPctLost: 300 }),
    ]);

    // Pooled baseline is 400/200 = 2. "a" sits at severity 1, below it.
    expect(ranked.map((r) => r.key)).toEqual(["b"]);
  });

  it("drops candidates that score zero rather than listing them as weaknesses", () => {
    const ranked = rankWeaknesses(
      [
        candidate({ key: "at-baseline", opportunities: 100, winPctLost: 100 }),
        candidate({ key: "worse", opportunities: 100, winPctLost: 500 }),
      ],
      { baselineSeverity: 1 },
    );

    expect(ranked.map((r) => r.key)).toEqual(["worse"]);
  });

  it("returns nothing when there is no evidence at all", () => {
    expect(rankWeaknesses([])).toEqual([]);
  });

  it("returns nothing when every candidate is below threshold", () => {
    const ranked = rankWeaknesses(
      [
        candidate({ key: "x", opportunities: 2, winPctLost: 500 }),
        candidate({ key: "y", opportunities: 1, winPctLost: 900 }),
      ],
      { baselineSeverity: 1 },
    );

    expect(ranked).toEqual([]);
  });

  it("keeps the evidence alongside each ranked weakness", () => {
    // The dashboard must be able to show opportunities, failures, rate and
    // cost without a second query.
    const [top] = rankWeaknesses(
      [candidate({ key: "fork", opportunities: 40, failures: 12, winPctLost: 600 })],
      { baselineSeverity: 1 },
    );

    expect(top).toMatchObject({
      key: "fork",
      opportunities: 40,
      failures: 12,
      winPctLost: 600,
    });
    expect(top?.failureRate).toBeCloseTo(0.3, 10);
  });
});
