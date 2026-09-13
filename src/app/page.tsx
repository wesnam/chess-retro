import Link from "next/link";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";
import { countGames } from "@/games/queries";
import { weaknessReport, type RankedWeakness } from "@/weakness/report";
import { MIN_GAMES, MIN_OPPORTUNITIES } from "@/weakness/score";
import type { WeaknessExample } from "@/weakness/queries";
import { TimeClassFilter } from "./TimeClassFilter";

// Reads live database state on every request.
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tc?: string }>;
}) {
  const db = getDb();
  const username = getUsername(db);

  if (!username) {
    return (
      <>
        <Heading />
        <div className="empty">
          <p>No chess.com username configured yet.</p>
          <p>
            <Link href="/settings">Add one in settings</Link> to get started.
          </p>
        </div>
      </>
    );
  }

  const counts = countGames(db, username);
  const { tc } = await searchParams;

  // Never a blend: one time control is always selected, defaulting to
  // whichever the player has the most games in.
  const available = counts.byTimeClass;
  const timeClass =
    available.find((t) => t.timeClass === tc)?.timeClass ??
    available[0]?.timeClass;

  if (!timeClass) {
    return (
      <>
        <Heading />
        <div className="empty">
          <p>
            No games downloaded yet for <strong>{username}</strong>.
          </p>
          <p>
            <Link href="/games">Sync your history</Link> to get started.
          </p>
        </div>
      </>
    );
  }

  const report = weaknessReport(db, { user: username, timeClass });

  return (
    <>
      <Heading />
      <TimeClassFilter available={available} selected={timeClass} />

      {report.weaknesses.length === 0 ? (
        <NoWeaknesses report={report} />
      ) : (
        <>
          <p className="lede">
            Ranked across {report.analysedMoves.toLocaleString()} analysed{" "}
            {timeClass} moves. You lose {report.baseline.toFixed(1)} points of
            win probability on an average move; these cost you more.
          </p>
          <ol className="weakness-list">
            {report.weaknesses.map((weakness) => (
              <li key={`${weakness.dimension}:${weakness.key}`}>
                <WeaknessCard weakness={weakness} />
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function Heading() {
  return (
    <>
      <h1>Your weaknesses</h1>
      <p className="lede">
        What you keep getting wrong, across every game — not just the last one.
      </p>
    </>
  );
}

/**
 * An honest empty state.
 *
 * Saying nothing here would read as "you have no weaknesses", which is never
 * the finding — it means the corpus is too small to tell one apart from noise.
 */
function NoWeaknesses({
  report,
}: {
  report: { analysedMoves: number; suppressed: number; timeClass: string };
}) {
  if (report.analysedMoves === 0) {
    return (
      <div className="empty">
        <p>No analysed {report.timeClass} games yet.</p>
        <p>
          <Link href="/games">Analyse your games</Link> to see what you keep
          getting wrong.
        </p>
      </div>
    );
  }

  return (
    <div className="empty">
      <p>
        Not enough evidence yet to name a weakness in {report.timeClass}.
      </p>
      <p className="hint">
        {report.suppressed > 0 ? (
          <>
            {report.suppressed} pattern{report.suppressed === 1 ? "" : "s"} came
            up too rarely to tell apart from chance. A weakness needs at least{" "}
            {MIN_OPPORTUNITIES} opportunities, spread across at least{" "}
            {MIN_GAMES} games — one bad game is an event, not a pattern.
            Analyse more games and they may qualify.
          </>
        ) : (
          <>
            Nothing in this time control costs you more than your own average.
            Analyse more games for a sharper picture.
          </>
        )}
      </p>
    </div>
  );
}

function WeaknessCard({ weakness }: { weakness: RankedWeakness }) {
  const rate = Math.round(weakness.failureRate * 100);

  return (
    <div className="weakness card">
      <div className="weakness-head">
        <h2>{weakness.label}</h2>
        <span className={`dimension ${weakness.dimension}`}>
          {dimensionName(weakness.dimension)}
        </span>
      </div>

      <dl className="weakness-stats">
        <Stat label="Opportunities" value={weakness.opportunities.toLocaleString()} />
        <Stat label="Went wrong" value={`${weakness.failures.toLocaleString()} (${rate}%)`} />
        <Stat
          label="Win probability lost"
          value={`${Math.round(weakness.winPctLost).toLocaleString()} pts`}
        />
        {weakness.referenceMissRate !== undefined ? (
          <Stat
            label="Players at your level"
            value={`${Math.round(weakness.referenceMissRate * 100)}% miss it`}
            note={`you ${rate}% — ${rate - Math.round(weakness.referenceMissRate * 100)} points worse`}
          />
        ) : (
          <Stat
            label="Versus your average"
            value={`${weakness.lift.toFixed(1)}×`}
            note={`${weakness.severity.toFixed(1)} pts per opportunity`}
          />
        )}
      </dl>

      {weakness.examples.length > 0 && (
        <div className="weakness-examples">
          <h3>From your own games</h3>
          <ul>
            {weakness.examples.map((example) => (
              <li key={`${example.gameId}:${example.ply}`}>
                <Example example={example} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Example({ example }: { example: WeaknessExample }) {
  const moveNumber = Math.ceil(example.ply / 2);
  const date = new Date(example.endTime * 1000).toISOString().slice(0, 10);

  return (
    <Link href={`/games/${example.gameId}?ply=${example.ply}`} className="example">
      <span className="example-move">
        {moveNumber}. {example.san}
      </span>
      {example.classification && (
        <span className={`tag ${example.classification}`}>
          {example.classification}
        </span>
      )}
      <span className="example-cost">
        −{example.winPctLost.toFixed(1)} pts
      </span>
      <span className="muted">
        vs {example.opponentUsername ?? "unknown"} · {date}
      </span>
    </Link>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="figure">
      <dt className="figure-label">{label}</dt>
      <dd className="figure-value">
        {value}
        {note && <span className="figure-note">{note}</span>}
      </dd>
    </div>
  );
}

function dimensionName(dimension: string): string {
  const names: Record<string, string> = {
    motif: "tactic",
    phase: "game phase",
    time: "time pressure",
    opening: "opening",
    piece: "piece",
  };
  return names[dimension] ?? dimension;
}
