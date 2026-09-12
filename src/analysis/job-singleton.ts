import { getDb } from "@/db/client";
import { poolSize, startPool, type ResilientEngine } from "@/engine/pool";
import { AnalysisJob, countPending, reclaimOrphanedGames, type Progress } from "./batch";
import { tagCorpus } from "./motifs/tag";
import { backfillPhases } from "@/weakness/backfill-phase";

/**
 * The one batch job for this server.
 *
 * Stashed on `globalThis` so Next's dev-mode hot reload reuses it rather than
 * starting a second job — which would put two sets of engines on the same
 * corpus and double the machine's load for no extra throughput.
 */
declare global {
  // eslint-disable-next-line no-var
  var __chessRetroJob:
    | { job: AnalysisJob; engines: ResilientEngine[]; user: string }
    | undefined;
  // eslint-disable-next-line no-var
  var __chessRetroReclaimed: boolean | undefined;
}

/**
 * Return games abandoned by a previous process to `pending`, once per boot.
 *
 * Safe to call at any time: a game held by a job running in THIS process is
 * left alone, so this can never steal work from a live run.
 */
export function reclaimOnce(): number {
  if (globalThis.__chessRetroReclaimed) return 0;
  globalThis.__chessRetroReclaimed = true;
  return reclaimOrphanedGames(getDb());
}

export type JobState = Progress & { pending: number };

export function jobState(user: string): JobState {
  const db = getDb();
  const pending = countPending(db, user);
  const current = globalThis.__chessRetroJob;

  if (!current || current.user !== user) {
    return {
      status: "idle",
      total: 0,
      completed: 0,
      failed: 0,
      remaining: pending,
      ratePerMs: undefined,
      etaMs: undefined,
      startedAt: undefined,
      pending,
    };
  }

  return { ...current.job.progress(), pending };
}

/**
 * Start analysing everything outstanding for this user.
 *
 * Returns immediately: the run continues in the background and progress is
 * polled separately, because a corpus takes hours and no request should wait
 * on it.
 */
export async function startJob(user: string): Promise<JobState> {
  const existing = globalThis.__chessRetroJob;
  if (existing && existing.job.progress().status === "running") {
    return jobState(user);
  }

  reclaimOnce();

  const db = getDb();

  // A paused job's workers are still finishing the games they hold. Reusing
  // or disposing its engines before they stop would write to an engine
  // mid-search and cross two positions' results.
  if (existing) await existing.job.settled();

  // Reuse the engines from a paused run rather than paying to start a new set.
  let engines;
  if (existing && existing.user === user) {
    engines = existing.engines;
  } else {
    engines = await startPool(poolSize());
    // A different user's engines are no longer needed. Disposed only after
    // that user's workers have stopped, above.
    if (existing) {
      for (const engine of existing.engines) engine.dispose();
    }
  }

  const job = new AnalysisJob({ db, user, engines });
  globalThis.__chessRetroJob = { job, engines, user };

  // Deliberately not awaited: the caller gets progress, not a finished corpus.
  void job
    .run()
    .then((progress) => {
      // Only on genuine completion. `run()` also resolves on pause, and a
      // synchronous corpus-wide pass there would block the event loop —
      // freezing the progress poll and the Resume button with it. Each game is
      // already tagged as it finishes, so this only sweeps up stragglers.
      if (progress.status !== "done") return;

      // Separate blocks so the two passes are genuinely independent. Sharing
      // one would let a tagging failure skip the phase backfill entirely,
      // and `phaseCandidates` ignores rows with no phase — so the whole
      // dimension would silently vanish from the dashboard.
      try {
        tagCorpus(db, user);
      } catch {
        // Derived data: a failure must not mark a finished analysis as
        // failed. The next run picks the games up again.
      }

      try {
        // Phase comes from the position, so it costs no engine time and can
        // be filled in over rows that already exist.
        backfillPhases(db, user);
      } catch {
        // As above.
      }
    })
    .catch(() => {
    // Individual game failures are recorded against their rows; a throw here
    // would be a job-level fault, and leaving it unhandled would take the
    // server down.
  });

  return jobState(user);
}

export function pauseJob(user: string): JobState {
  const current = globalThis.__chessRetroJob;
  // Only this user's job: pausing on one page must not silently stop a run
  // belonging to a different configured username.
  if (current?.user === user) current.job.pause();
  return jobState(user);
}

/**
 * Stop the engines, so shutdown does not orphan Stockfish processes.
 *
 * Synchronous on purpose: it runs from a signal handler, where there is no
 * opportunity to await. The games still in flight are abandoned mid-search and
 * left `running`, which is exactly what startup reclaims.
 */
export function stopJob(): void {
  const current = globalThis.__chessRetroJob;
  if (!current) return;

  current.job.pause();
  for (const engine of current.engines) engine.dispose();
  globalThis.__chessRetroJob = undefined;
}
