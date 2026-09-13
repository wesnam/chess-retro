import type { Motif } from "@/analysis/motifs/detect";
import type { InsightRequest } from "./request";

/**
 * The guard between the model's output and the page.
 *
 * The prompt tells the model to treat the statistics as ground truth and to
 * invent nothing. That instruction is necessary and not sufficient: a model
 * that knows a lot about chess can write a fluent, plausible paragraph about
 * a weakness this player was never measured for. Everything the model returns
 * is therefore checked back against the request that produced it, and
 * anything unsupported is dropped rather than shown.
 *
 * Dropping rather than failing: one invented weakness should cost that
 * paragraph, not the whole explanation.
 */

/**
 * Every motif a detector can produce — a spelling check, not a relevance one.
 *
 * Spelled out rather than derived from a value so that `satisfies` fails the
 * build if `Motif` gains a member: these are what ticket 10 will look puzzles
 * up by, and a theme that matches no puzzle is worse than no theme. A theme
 * must ALSO appear in the request to survive (see `validateCoaching`) — being
 * a real motif is not the same as being this player's problem.
 */
const PRACTICE_THEMES = [
  "fork",
  "pin",
  "skewer",
  "discoveredAttack",
  "doubleCheck",
  "backRankMate",
  "hangingPiece",
  "deflection",
  "trappedPiece",
  "sacrifice",
  "quietMove",
  "mateIn1",
] as const satisfies readonly Motif[];

const KNOWN_THEMES: ReadonlySet<string> = new Set(PRACTICE_THEMES);

export type CoachedWeakness = {
  /** A "dimension:key" id from the request; anything else was dropped. */
  key: string;
  explanation: string;
  /** A plausible account of why the error happens. */
  why: string;
};

export type Coaching = {
  weaknesses: CoachedWeakness[];
  practice: {
    summary: string;
    /** Detected motifs only — checked, not trusted. */
    themes: string[];
  };
};

export type ValidationResult =
  | { ok: true; value: Coaching; dropped: string[] }
  | { ok: false; reason: string };

export function validateCoaching(
  raw: unknown,
  request: InsightRequest,
): ValidationResult {
  if (!isRecord(raw)) return { ok: false, reason: "not an object" };

  const rawWeaknesses = raw.weaknesses;
  if (!Array.isArray(rawWeaknesses)) {
    return { ok: false, reason: "no weaknesses array" };
  }

  // Matched on the qualified id rather than the bare key, so a motif and an
  // opening family that happen to share a key cannot collapse into one
  // paragraph shown on both cards.
  const supplied = new Set(request.weaknesses.map((w) => w.id));
  const dropped: string[] = [];
  const seen = new Set<string>();
  const weaknesses: CoachedWeakness[] = [];

  for (const entry of rawWeaknesses) {
    if (!isRecord(entry)) continue;

    const key = text(entry.key);
    const explanation = text(entry.explanation);
    const why = text(entry.why);
    if (!key || !explanation || !why) continue;

    // The whole point: a weakness the queries never found cannot be shown,
    // however well-written the paragraph about it is.
    if (!supplied.has(key) || seen.has(key)) {
      dropped.push(key);
      continue;
    }

    seen.add(key);
    weaknesses.push({ key, explanation, why });
  }

  if (weaknesses.length === 0) {
    return { ok: false, reason: "no weakness survived validation" };
  }

  const practice = isRecord(raw.practice) ? raw.practice : {};
  const themes = Array.isArray(practice.themes) ? practice.themes : [];

  // Two gates, and the second is the one that matters. A model that knows
  // chess will happily recommend drilling back-rank mates to a player whose
  // data never mentioned them: the theme is correctly spelled, a real
  // detector emits it, and it is still a claim about chess rather than about
  // this player. Only motifs actually measured here survive.
  const measured = new Set(
    request.weaknesses
      .filter((weakness) => weakness.dimension === "motif")
      .map((weakness) => weakness.key),
  );

  return {
    ok: true,
    dropped,
    value: {
      weaknesses,
      practice: {
        summary: text(practice.summary) ?? "",
        themes: themes
          .map((theme) => text(theme))
          .filter(
            (theme): theme is string =>
              !!theme && KNOWN_THEMES.has(theme) && measured.has(theme),
          ),
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A usable string, or nothing — blank and whitespace are not content. */
function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
