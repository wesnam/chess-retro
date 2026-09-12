import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";
import { getGame, listMissedMotifs, listMoves } from "@/games/queries";
import { AnalyzeButton } from "./AnalyzeButton";
import { GameReview } from "./GameReview";

export const dynamic = "force-dynamic";

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ply?: string | string[] }>;
}) {
  const { id } = await params;
  const { ply } = await searchParams;
  const db = getDb();
  const username = getUsername(db);
  if (!username) notFound();

  const game = getGame(db, username, id);
  if (!game) notFound();

  const moves = listMoves(db, username, id);
  const missedMotifs = listMissedMotifs(db, username, id);
  const analysed = game.analysisStatus === "done";

  return (
    <>
      <p className="crumb">
        <Link href="/games">← All games</Link>
      </p>

      <h1>
        {game.userColor === "w" ? "White" : "Black"} vs{" "}
        {game.opponentUsername ?? "opponent"}
      </h1>
      <p className="lede">
        {resultLabel(game.userResult)}
        {game.userResultRaw ? ` by ${game.userResultRaw}` : ""} ·{" "}
        {game.timeClass} · {formatDate(game.endTime)}
        {game.openingName ? ` · ${game.openingName}` : ""}
      </p>

      {analysed ? (
        <AccuracyPanel game={game} />
      ) : (
        <AnalyzeButton gameId={id} />
      )}

      {game.analysisStatus === "error" && game.analysisError && (
        <p className="notice error">{game.analysisError}</p>
      )}

      {moves.length === 0 ? (
        <div className="empty">
          <p>No moves stored for this game.</p>
        </div>
      ) : (
        <GameReview
          moves={moves}
          userColor={game.userColor}
          analysed={analysed}
          missedMotifs={Object.fromEntries(missedMotifs)}
          initialIndex={openingPosition(ply)}
        />
      )}

      {game.url && (
        <p className="hint">
          <a href={game.url} target="_blank" rel="noreferrer">
            View on chess.com
          </a>
        </p>
      )}
    </>
  );
}

function AccuracyPanel({
  game,
}: {
  game: {
    accuracyUser: number | null;
    ccAccuracyUser: number | null;
    analysisDepth: number | null;
  };
}) {
  return (
    <div className="accuracy-panel">
      <div className="figure">
        <span className="figure-label">Accuracy</span>
        <span className="figure-value">
          {game.accuracyUser != null ? `${game.accuracyUser.toFixed(1)}%` : "—"}
        </span>
        <span className="figure-note">
          {game.analysisDepth ? `Stockfish depth ${game.analysisDepth}` : ""}
        </span>
      </div>

      <div className="figure">
        <span className="figure-label">chess.com says</span>
        <span className="figure-value muted">
          {game.ccAccuracyUser != null
            ? `${game.ccAccuracyUser.toFixed(1)}%`
            : "—"}
        </span>
        <span className="figure-note">
          {/* Shown for comparison only; it never enters any aggregate. */}
          for comparison only
        </span>
      </div>
    </div>
  );
}

/**
 * Which board position a `?ply=` link should open on.
 *
 * A dashboard example names the PLY of the move that went wrong, and the
 * position the player was actually looking at is the one before it — opening
 * on the ply itself would show the board after the mistake was already made.
 */
export function openingPosition(ply: string | string[] | undefined): number {
  // A repeated query parameter arrives as an array, not a string.
  if (typeof ply !== "string") return 0;
  // Digits only. `Number` accepts far more than this guard implies — "0x10"
  // is 16, "1e3" is 1000, " 7 " is 7 — and each would silently open the board
  // somewhere the link never named.
  if (!/^\d+$/.test(ply)) return 0;
  const parsed = Number(ply);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 0;
  return parsed - 1;
}

function resultLabel(result: string): string {
  if (result === "win") return "Won";
  if (result === "loss") return "Lost";
  return "Drew";
}

function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
