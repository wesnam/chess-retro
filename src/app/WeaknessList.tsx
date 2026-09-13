"use client";

import Link from "next/link";
import type { RankedWeakness } from "@/weakness/report";
import { weaknessId } from "@/insights/request";
import type { WeaknessExample } from "@/weakness/queries";
import { weaknessCopy } from "@/weakness/copy";
import {
  CoachNote,
  PracticePlan,
  useCoaching,
  type CoachingState,
} from "./Coaching";

/**
 * The ranked weaknesses, with the coach's prose filled in once it arrives.
 *
 * A client component so the statistics render immediately and the coaching —
 * which may involve a model call on a corpus it has not seen before — lands
 * afterwards without holding up the page.
 */
export function WeaknessList({
  weaknesses,
  timeClass,
}: {
  weaknesses: RankedWeakness[];
  timeClass: string;
}) {
  const coaching = useCoaching(timeClass);

  return (
    <>
      <PracticePlan coaching={coaching} />
      <ol className="weakness-list">
        {weaknesses.map((weakness) => (
          <li key={weaknessId(weakness)}>
            <WeaknessCard weakness={weakness} coaching={coaching} />
          </li>
        ))}
      </ol>
    </>
  );
}

function WeaknessCard({
  weakness,
  coaching,
}: {
  weakness: RankedWeakness;
  coaching: CoachingState;
}) {
  const copy = weaknessCopy(weakness);
  const rate = Math.round(weakness.failureRate * 100);
  const peers =
    weakness.referenceMissRate !== undefined
      ? Math.round(weakness.referenceMissRate * 100)
      : undefined;

  return (
    <div className="weakness card">
      <div className="weakness-head">
        <h2>{copy.title}</h2>
        <span className={`dimension ${weakness.dimension}`}>
          {dimensionName(weakness.dimension)}
        </span>
      </div>

      {copy.explanation && <p className="weakness-what">{copy.explanation}</p>}

      {/* The comparison, as a sentence rather than a lone multiple. */}
      <p className="weakness-claim">
        {peers !== undefined ? (
          <>
            You get it wrong <strong>{rate}%</strong> of the time. Players at
            your rating: <strong>{peers}%</strong>.
          </>
        ) : (
          <>
            You get it wrong <strong>{rate}%</strong> of the time —{" "}
            <strong>{weakness.lift.toFixed(1)}×</strong> what an average move of
            yours costs.
          </>
        )}
      </p>

      <CoachNote coaching={coaching} weaknessKey={weaknessId(weakness)} />

      <dl className="weakness-stats">
        <Stat label="Chances" value={weakness.opportunities.toLocaleString()} />
        <Stat label="Got it wrong" value={weakness.failures.toLocaleString()} />
        <Stat
          label="Win probability lost"
          value={`${Math.round(weakness.winPctLost).toLocaleString()} pts`}
        />
        <Stat
          label="Seen across"
          value={`${weakness.games} game${weakness.games === 1 ? "" : "s"}`}
        />
      </dl>

      {weakness.examples.length > 0 && (
        <div className="weakness-examples">
          <h3>See it in your own games</h3>
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
