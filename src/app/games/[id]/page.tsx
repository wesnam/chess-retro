import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";
import { getGame, listMissedMotifs, listMoves } from "@/games/queries";
import { AnalyzeButton } from "./AnalyzeButton";
import { GameReview } from "./GameReview";
import { positionForPly } from "@/games/position-move";
import { tallyMarks, type MoveMarks } from "@/games/move-marks";
import {
  describeQuality,
  qualityPercentile,
  qualityScore,
} from "@/games/game-quality";

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
        <AccuracyPanel game={game} marks={tallyMarks(moves)} />
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
  marks,
}: {
  game: {
    accuracyUser: number | null;
    ccAccuracyUser: number | null;
    analysisDepth: number | null;
  };
  marks: MoveMarks;
}) {
  // Where this game sits among games that were actually measured. It is not
  // a rating: see `game-quality.ts` for why one game cannot carry a player's
  // strength, and what was measured to establish that.
  const quality = qualityPercentile(qualityScore(marks));

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

      <div className="figure marks-figure">
        <span className="figure-label">Your moves</span>
        <Marks marks={marks} />
      </div>

      <div className="figure">
        <span className="figure-label">Game quality</span>
        {/*
          Shown for every analysed game, unlike the estimate it replaced,
          which needed a chess.com review and so was blank on three quarters
          of them. An em dash when a game has no classified moves keeps the
          panel at four figures rather than reflowing to three.
        */}
        <span className="figure-value">
          {quality !== undefined ? `${ordinal(quality)}` : "—"}
        </span>
        <span className="figure-note">{describeQuality(quality) ?? ""}</span>
      </div>
    </div>
  );
}

/**
 * The six grades for this game.
 *
 * Grades the player never earned are dimmed rather than dropped, so the marks
 * hold the same six positions on every game and the eye learns where to look
 * for blunders instead of re-reading the row each time.
 */
function Marks({ marks }: { marks: MoveMarks }) {
  const grades = [
    { key: "best", symbol: "★", label: "best" },
    { key: "excellent", symbol: "!", label: "excellent" },
    { key: "good", symbol: "·", label: "good" },
    { key: "inaccuracy", symbol: "?!", label: "inaccuracy" },
    { key: "mistake", symbol: "?", label: "mistake" },
    { key: "blunder", symbol: "??", label: "blunder" },
  ] as const;

  return (
    <span className="marks">
      {grades.map(({ key, symbol, label }) => {
        const count = marks[key];
        return (
          <span
            key={key}
            className={`mark ${key}${count === 0 ? " none" : ""}`}
            title={`${count} ${label}${count === 1 ? "" : "s"}`}
          >
            <span className="mark-symbol">{symbol}</span>
            {count}
          </span>
        );
      })}
    </span>
  );
}

/** A percentile as an ordinal, so "64" reads as a rank rather than a score. */
function ordinal(value: number): string {
  const rest = value % 100;
  if (rest >= 11 && rest <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
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
  // The position that ply PRODUCED, so a link to a blunder opens the board
  // with the blunder played and the cursor on it.
  return positionForPly(parsed);
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
