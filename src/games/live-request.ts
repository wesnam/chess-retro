import { Chess } from "chess.js";

export type LiveRequest = { fen: string };

/**
 * Validate what a live-analysis request is asking about.
 *
 * The FEN goes straight into a `position fen ...` line on the engine's stdin,
 * and UCI is a line protocol — so a newline inside it would end the command
 * and turn everything after into a second command of the caller's choosing.
 * Rejected here rather than escaped: there is no position that legitimately
 * contains one.
 *
 * The board is then parsed, because a string can survive the character check
 * and still not be a position an engine can be asked about.
 */
export function readLiveRequest(body: unknown): LiveRequest | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const fen = (body as { fen?: unknown }).fen;
  if (typeof fen !== "string" || fen === "") return undefined;
  if (/[\r\n]/.test(fen)) return undefined;

  try {
    // chess.js rejects a board with no kings, the wrong number of ranks, and
    // the rest. Constructing it is the validation.
    new Chess(fen);
  } catch {
    return undefined;
  }

  return { fen };
}
