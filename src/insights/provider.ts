import type { InsightRequest } from "./request";

/**
 * The seam between the coach and whoever writes the prose.
 *
 * Deliberately narrow: a request in, unparsed JSON out. Everything that makes
 * the output trustworthy — what the model is allowed to see, and what it is
 * allowed to claim — lives on this side of the interface in `request.ts` and
 * `validate.ts`, so swapping the provider cannot weaken it.
 */
export type CoachProvider = {
  /** Identifies the model in the cache, so a model change invalidates it. */
  readonly model: string;
  /** Returns parsed-but-unvalidated JSON. Throws on transport failure. */
  explain(request: InsightRequest): Promise<unknown>;
};

/** Raised when the model was reached but said something unusable. */
export class CoachError extends Error {}
