import Link from "next/link";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";
import {
  countGames,
  listGames,
  type GameListRow,
  type MoveMarks,
} from "@/games/queries";
import { SyncButton } from "./SyncButton";
import { AnalyzeAllButton } from "./AnalyzeAllButton";

// Reads live database state on every request.
export const dynamic = "force-dynamic";

export default function GamesPage() {
  const db = getDb();
  const username = getUsername(db);

  if (!username) {
    return (
      <>
        <h1>Games</h1>
        <div className="empty">
          <p>
            <Link href="/settings">Configure a username</Link> to download
            games.
          </p>
        </div>
      </>
    );
  }

  const rows = listGames(db, username);
  const counts = countGames(db, username);

  return (
    <>
      <h1>Games</h1>
      <p className="lede">
        {counts.total > 0 ? (
          <>
            {counts.total} game{counts.total === 1 ? "" : "s"} for{" "}
            <strong>{username}</strong> — {counts.byResult.win}W{" "}
            {counts.byResult.loss}L {counts.byResult.draw}D
          </>
        ) : (
          <>Nothing downloaded yet for {username}.</>
        )}
      </p>

      <SyncButton />
      {rows.length > 0 && <AnalyzeAllButton />}

      {rows.length === 0 ? (
        <div className="empty">
          <p>Press “Sync games” to download your history from chess.com.</p>
        </div>
      ) : (
        <GameTable rows={rows} />
      )}
    </>
  );
}

function GameTable({ rows }: { rows: GameListRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Colour</th>
            <th>Result</th>
            <th>Opponent</th>
            <th className="num">Rating</th>
            <th>Time</th>
            <th>Opening</th>
            <th>Marks</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="muted">
                <Link href={`/games/${row.id}`}>{formatDate(row.endTime)}</Link>
              </td>
              <td>
                <span className={`disc ${row.userColor === "w" ? "white" : "black"}`} />
                {row.userColor === "w" ? "White" : "Black"}
              </td>
              <td>
                <span className={`result ${row.userResult}`}>
                  {resultLabel(row.userResult)}
                </span>
                {row.userResultRaw && (
                  <span className="muted"> {row.userResultRaw}</span>
                )}
              </td>
              <td>{row.opponentUsername ?? "—"}</td>
              <td className="num">
                {row.userRating ?? "—"}
                {row.opponentRating != null && (
                  <span className="muted"> vs {row.opponentRating}</span>
                )}
              </td>
              <td>
                {row.timeClass}
                {row.timeControl && (
                  <span className="muted"> {formatTimeControl(row.timeControl)}</span>
                )}
              </td>
              <td className="muted opening">{row.openingName ?? "—"}</td>
              <td>
                <Marks marks={row.marks} analysed={row.analysisStatus === "done"} />
              </td>
              <td className="muted">
                {row.analysisStatus === "done" ? "reviewed" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The six grades for one game, best to blunder.
 *
 * Shown only once the game is analysed: a row of zeroes on an unreviewed game
 * reads as a flawless performance rather than an absent one.
 *
 * Grades the player never earned are dimmed rather than dropped, so the marks
 * sit in the same six columns on every row and the eye can run down one grade
 * without re-reading the labels.
 */
function Marks({ marks, analysed }: { marks: MoveMarks; analysed: boolean }) {
  if (!analysed) return <span className="muted">—</span>;

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

/** "180" is three minutes; "600+5" is ten minutes with a five-second increment. */
function formatTimeControl(raw: string): string {
  const [base, increment] = raw.split("+");
  const seconds = Number(base);
  if (!Number.isFinite(seconds)) return raw;

  const minutes = seconds / 60;
  const label = Number.isInteger(minutes) ? `${minutes}m` : `${seconds}s`;
  return increment ? `${label}+${increment}` : label;
}
