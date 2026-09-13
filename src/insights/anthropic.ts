import Anthropic from "@anthropic-ai/sdk";
import type { CoachProvider } from "./provider";
import { CoachError } from "./provider";
import type { InsightRequest } from "./request";
import { resolveModel } from "./model";

/**
 * The coach, as an Anthropic call.
 *
 * The only file in this module that knows a model is involved at all; which
 * model it is lives in `model.ts`. The key is read from the process environment
 * and never leaves the server: this module is imported by server components
 * and route handlers only, and nothing it exports reaches the browser.
 */

/**
 * Resolved once at module load, so every request in a process uses one model
 * and the cache cannot be split across two of them mid-run.
 */
const MODEL = resolveModel(process.env.CHESS_RETRO_COACH_MODEL);

/**
 * The output shape, enforced by the API rather than requested in prose.
 *
 * A schema does not make the CONTENT true — `validate.ts` is what checks the
 * claims — but it removes the entire class of failures where a model returns
 * prose around its JSON, or renames a field, and the parse falls over.
 */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    weaknesses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description:
              'The exact `id` of the weakness being explained, copied verbatim (e.g. "motif:fork").',
          },
          explanation: {
            type: "string",
            description:
              "Two or three sentences telling the player what this means for them, citing their own example positions.",
          },
          why: {
            type: "string",
            description:
              "One or two sentences on why a player might be making this error.",
          },
        },
        required: ["key", "explanation", "why"],
        additionalProperties: false,
      },
    },
    practice: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "A short practice plan across all the weaknesses.",
        },
        themes: {
          type: "array",
          items: { type: "string" },
          description: "Motif keys to drill, taken only from the supplied data.",
        },
      },
      required: ["summary", "themes"],
      additionalProperties: false,
    },
  },
  required: ["weaknesses", "practice"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are a chess coach reviewing one player's own game history.

The statistics you are given are ground truth, computed from every analysed
position in this player's games. Treat them as facts.

Rules, in order of importance:

1. Identify each weakness by its \`id\` exactly as supplied, copied verbatim.
2. Explain ONLY the weaknesses in the supplied data. Never introduce a
   weakness that is not there, however common it is among players generally.
   You are describing this player, not chess.
3. Never contradict a supplied number, and never invent one. If you cite a
   figure it must be one you were given.
4. Cite the player's own example positions when explaining a weakness, using
   the \`move\` field exactly as supplied (e.g. "24. Nxe5", or "18...Nc6" for
   a move by Black). Never compute a move number yourself and never cite
   \`ply\`, which counts each side's moves separately and is roughly double the
   move number. Each example is labelled worst, typical or recent — "recent"
   is the evidence for whether the problem is still happening.
5. Practice themes must be the \`key\` (not the id) of motif weaknesses that
   appear in the supplied data. Do not invent theme names, and do not suggest
   a motif that is not in this player's data.
6. Write to the player as "you". Be direct and concrete. No preamble, no
   flattery, no hedging about being an AI.`;

export function anthropicCoach(apiKey: string): CoachProvider {
  const client = new Anthropic({ apiKey });

  return {
    model: MODEL,
    async explain(request: InsightRequest): Promise<unknown> {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        thinking: { type: "adaptive" },
        output_config: {
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
        messages: [{ role: "user", content: userPrompt(request) }],
      });

      if (response.stop_reason === "refusal") {
        throw new CoachError("The model declined to answer.");
      }

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      if (!text.trim()) throw new CoachError("The model returned nothing.");

      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new CoachError("The model did not return JSON.");
      }
    },
  };
}

function userPrompt(request: InsightRequest): string {
  return [
    `Time control: ${request.timeClass}.`,
    `Analysed positions: ${request.analysedMoves}.`,
    `This player loses ${request.baseline} points of win probability on an average move; the weaknesses below cost more than that.`,
    "",
    "Ranked weaknesses, worst first, as JSON:",
    JSON.stringify(request.weaknesses, null, 2),
    "",
    "Explain each one, then give a practice plan.",
  ].join("\n");
}

/**
 * The configured coach, or nothing.
 *
 * Server-side only. Returning undefined rather than throwing is what lets the
 * dashboard degrade to raw statistics when no key is set.
 */
export function coachFromEnv(): CoachProvider | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  return apiKey ? anthropicCoach(apiKey) : undefined;
}
