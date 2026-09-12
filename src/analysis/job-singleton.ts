import { getDb } from "@/db/client";
import { poolSize, startPool, type ResilientEngine } from "@/engine/pool";
import { AnalysisJob, countPending, reclaimOrphanedGames, type Progress } from "./batch";

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
  // Reuse the engines from a paused run rather than paying to start a new set.
  const engines =
    existing && existing.user === user
      ? existing.engines
      : await startPool(poolSize());

  // A different user's engines are no longer needed.
  if (existing && existing.user !== user) {
    for (const engine of existing.engines) engine.dispose();
  }

  const job = new AnalysisJob({ db, user, engines });
  globalThis.__chessRetroJob = { job, engines, user };

  // Deliberately not awaited: the caller gets progress, not a finished corpus.
  void job.run().catch(() => {
    // Individual game failures are recorded against their rows; a throw here
    // would be a job-level fault, and leaving it unhandled would take the
    // server down.
  });

  return jobState(user);
}

export function pauseJob(user: string): JobState {
  globalThis.__chessRetroJob?.job.pause();
  return jobState(user);
}

/** Stop the engines, so shutdown does not orphan Stockfish processes. */
export function stopJob(): void {
  const current = globalThis.__chessRetroJob;
  if (!current) return;

  current.job.pause();
  for (const engine of current.engines) engine.dispose();
  globalThis.__chessRetroJob = undefined;
}
