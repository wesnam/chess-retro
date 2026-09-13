import { createHash } from "node:crypto";
import type { RankedWeakness, WeaknessReport } from "@/weakness/report";
import { weaknessCopy } from "@/weakness/copy";
import { selectExamples, type ExampleRole } from "./examples";
import { describeMove, moveNumber } from "@/games/move-notation";

/**
 * The payload the model is given, and the key it is cached under.
 *
 * This is the ground truth of the whole feature. Every number and every
 * position in here was computed by a query; the model's only job is to turn
 * them into something a person can act on. Anything NOT in this object is
 * something the coach must not be able to claim — which is what makes the
 * validation in `validate.ts` possible at all.
 */

export type InsightExample = {
  role: ExampleRole;
  gameId: string;
  ply: number;
  /**
   * The move number a player would cite, supplied rather than derived.
   *
   * The model is given this so it never has to convert a ply itself: asked to,
   * a weaker one quotes the raw ply as a move number and sends the reader past
   * the end of the game.
   */
  moveNumber: number;
  /** "24. Nxe5", or "18...Nc6" for Black — how a person refers to the move. */
  move: string;
  fen: string;
  classification: string | null;
  winPctLost: number;
  /** ISO date, so the coach can say whether this is still happening. */
  playedOn: string;
  opponent: string | null;
};

export type InsightWeakness = {
  /**
   * How the model refers to this weakness, and how the dashboard keys its
   * cards: "motif:fork". Dimensions have separate key spaces, so the bare key
   * is not unique and matching on it can put one paragraph on two cards.
   */
  id: string;
  dimension: string;
  key: string;
  label: string;
  /** The deterministic claim, so the model elaborates rather than re-derives. */
  title: string;
  opportunities: number;
  failures: number;
  failureRate: number;
  winPctLost: number;
  games: number;
  lift: number;
  /** How often players of similar strength miss it; absent for non-motifs. */
  referenceMissRate: number | null;
  examples: InsightExample[];
};

export type InsightRequest = {
  timeClass: string;
  analysedMoves: number;
  /** Win probability lost on an average move — the standard for "worse". */
  baseline: number;
  weaknesses: InsightWeakness[];
};

/** The dashboard's card key, and the model's handle for a weakness. */
export function weaknessId(weakness: {
  dimension: string;
  key: string;
}): string {
  return `${weakness.dimension}:${weakness.key}`;
}

export function buildRequest(report: WeaknessReport): InsightRequest {
  return {
    timeClass: report.timeClass,
    analysedMoves: report.analysedMoves,
    baseline: round(report.baseline, 2),
    weaknesses: report.weaknesses.map(toInsightWeakness),
  };
}

function toInsightWeakness(weakness: RankedWeakness): InsightWeakness {
  return {
    id: weaknessId(weakness),
    dimension: weakness.dimension,
    key: weakness.key,
    label: weakness.label,
    title: weaknessCopy(weakness).title,
    opportunities: weakness.opportunities,
    failures: weakness.failures,
    failureRate: round(weakness.failureRate, 4),
    winPctLost: round(weakness.winPctLost, 1),
    games: weakness.games,
    lift: round(weakness.lift, 2),
    referenceMissRate:
      weakness.referenceMissRate === undefined
        ? null
        : round(weakness.referenceMissRate, 4),
    examples: selectExamples(weakness.examples).map(({ role, example }) => ({
      role,
      gameId: example.gameId,
      ply: example.ply,
      moveNumber: moveNumber(example.ply),
      move: describeMove(example.ply, example.san),
      fen: example.fenBefore,
      classification: example.classification,
      winPctLost: round(example.winPctLost, 1),
      playedOn: new Date(example.endTime * 1000).toISOString().slice(0, 10),
      opponent: example.opponentUsername,
    })),
  };
}

/**
 * The cache key: everything that determines what the answer should be.
 *
 * Three things, not one. The statistics are the obvious part — keyed on those
 * rather than on the game count, so analysing more games that do not move the
 * ranking still hits the cache. But identical statistics do not make identical
 * coaching: the prose is addressed to a particular player and is written by a
 * particular model, so both belong in the key. Leaving the player out would
 * serve one person's explanation to another; leaving the model out would go on
 * serving the old model's prose forever after an upgrade.
 */
export function hashRequest(
  request: InsightRequest,
  identity: { user: string; model: string },
): string {
  return createHash("sha256")
    .update(
      serialise({
        user: identity.user,
        model: identity.model,
        request,
      }),
    )
    .digest("hex");
}

/**
 * Field order is fixed by the types above rather than by key sorting, so the
 * hash cannot drift when a field is added in the middle of a type.
 */
function serialise(payload: {
  user: string;
  model: string;
  request: InsightRequest;
}): string {
  return JSON.stringify(payload);
}

/**
 * Floats are rounded before hashing. Severity and lift come out of SQL
 * arithmetic, so the last bits of a double can differ between runs over
 * identical data and would otherwise miss the cache every time.
 */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
