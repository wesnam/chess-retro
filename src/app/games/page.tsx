import Link from "next/link";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";
import { countGames, listGames, type GameListRow } from "@/games/queries";
import { SyncButton } from "./SyncButton";

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
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="muted">{formatDate(row.endTime)}</td>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
