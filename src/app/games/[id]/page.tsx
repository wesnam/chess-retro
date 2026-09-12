import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";
import { getGame, listMoves, type MoveRow } from "@/games/queries";
import { AnalyzeButton } from "./AnalyzeButton";

export const dynamic = "force-dynamic";

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const username = getUsername(db);
  if (!username) notFound();

  const game = getGame(db, username, id);
  if (!game) notFound();

  const moves = listMoves(db, username, id);
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
        <MoveList moves={moves} analysed={analysed} />
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

function MoveList({ moves, analysed }: { moves: MoveRow[]; analysed: boolean }) {
  // Pair the plies into numbered moves, as a scoresheet reads.
  const pairs: Array<{ number: number; white?: MoveRow; black?: MoveRow }> = [];
  for (const move of moves) {
    const number = Math.ceil(move.ply / 2);
    const pair = pairs.at(-1);
    if (pair?.number === number) {
      pair.black = move;
    } else {
      pairs.push(
        move.color === "w"
          ? { number, white: move }
          : { number, black: move },
      );
    }
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="num">#</th>
            <th>White</th>
            {analysed && <th>Eval</th>}
            <th>Black</th>
            {analysed && <th>Eval</th>}
          </tr>
        </thead>
        <tbody>
          {pairs.map((pair) => (
            <tr key={pair.number}>
              <td className="num muted">{pair.number}.</td>
              <MoveCell move={pair.white} analysed={analysed} />
              <MoveCell move={pair.black} analysed={analysed} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MoveCell({
  move,
  analysed,
}: {
  move: MoveRow | undefined;
  analysed: boolean;
}) {
  if (!move) {
    return (
      <>
        <td />
        {analysed && <td />}
      </>
    );
  }

  return (
    <>
      <td>
        <span className={move.isUserMove ? "san mine" : "san"}>{move.san}</span>
        {move.classification && (
          <span className={`tag ${move.classification}`}>
            {shortLabel(move.classification)}
          </span>
        )}
      </td>
      {analysed && (
        <td className="num muted">
          {formatEval(move)}
          {move.classification &&
            move.classification !== "best" &&
            move.bestMoveUci &&
            isSerious(move.classification) && (
              <span className="best-move"> best {move.bestMoveUci}</span>
            )}
        </td>
      )}
    </>
  );
}

function isSerious(classification: string): boolean {
  return ["inaccuracy", "mistake", "blunder"].includes(classification);
}

/** The evaluation after the move, in White's perspective, as players read it. */
function formatEval(move: MoveRow): string {
  const sign = move.color === "w" ? 1 : -1;

  if (move.mateAfter != null) {
    const distance = move.mateAfter * sign;
    return `M${Math.abs(distance)}${distance < 0 ? "−" : "+"}`;
  }
  if (move.evalAfter == null) return "—";

  const pawns = (move.evalAfter * sign) / 100;
  return `${pawns >= 0 ? "+" : "−"}${Math.abs(pawns).toFixed(2)}`;
}

function shortLabel(classification: string): string {
  const labels: Record<string, string> = {
    best: "best",
    excellent: "good",
    good: "ok",
    inaccuracy: "?!",
    mistake: "?",
    blunder: "??",
  };
  return labels[classification] ?? classification;
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
