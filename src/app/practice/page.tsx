import Link from "next/link";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";
import { countGames } from "@/games/queries";
import { motifExplanation, motifTitle } from "@/analysis/motifs/labels";
import { KNOWN_THEMES } from "@/insights/validate";
import { isImported, puzzleCount } from "@/puzzles/import";
import { playerRating, themeProgress } from "@/puzzles/select";
import { PracticeSession } from "./PracticeSession";
import { PuzzleImport } from "./PuzzleImport";

/**
 * Practising one weakness.
 *
 * Reached from a weakness card on the dashboard, so it always arrives with a
 * theme. The statistics and the import state are rendered on the server; the
 * puzzles themselves are fetched by the client, which is what lets a session
 * pull a fresh set without a page load.
 */
export const dynamic = "force-dynamic";

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; tc?: string }>;
}) {
  const { theme, tc } = await searchParams;
  const db = getDb();
  const username = getUsername(db);

  if (!username) {
    return (
      <>
        <h1>Practice</h1>
        <div className="empty">
          <p>No chess.com username configured yet.</p>
          <p>
            <Link href="/settings">Add one in settings</Link> to get started.
          </p>
        </div>
      </>
    );
  }

  // Validated against the detector vocabulary: an unknown theme would return
  // an empty set that reads as "nothing to practise here".
  if (!theme || !KNOWN_THEMES.has(theme)) {
    return (
      <>
        <h1>Practice</h1>
        <div className="empty">
          <p>Pick a weakness to practise.</p>
          <p>
            <Link href="/">Your weaknesses</Link> links through to puzzles for
            each tactic you keep missing.
          </p>
        </div>
      </>
    );
  }

  const available = countGames(db, username).byTimeClass;
  const timeClass =
    available.find((t) => t.timeClass === tc)?.timeClass ??
    available[0]?.timeClass;
  const rating = timeClass
    ? playerRating(db, { user: username, timeClass })
    : undefined;

  const progress = themeProgress(db, { user: username, theme });
  const explanation = motifExplanation(theme);

  return (
    <>
      <p className="crumb">
        <Link href="/">← Your weaknesses</Link>
      </p>
      <h1>{motifTitle(theme)}</h1>
      {explanation && <p className="lede">{explanation}</p>}

      {!isImported(db) ? (
        <PuzzleImport />
      ) : (
        <PracticeSession
          theme={theme}
          timeClass={timeClass}
          rating={rating}
          initialProgress={progress}
          available={puzzleCount(db)}
        />
      )}
    </>
  );
}
