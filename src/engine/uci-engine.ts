import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { Score } from "@/analysis/accuracy";

/**
 * One Stockfish process, spoken to over UCI.
 *
 * stdout is read through `readline` rather than raw `data` events. A chunk
 * boundary lands mid-line often enough that parsing chunks directly is the
 * single most common bug in naive UCI code: a long `info` line arrives in two
 * pieces and both halves are discarded as unparseable.
 */

export type EngineOptions = {
  /** Path to the binary. Defaults to whatever `stockfish` resolves to. */
  path?: string;
  /** Search depth per position. */
  depth?: number;
  /**
   * Threads for this engine. One is right when running several engines in
   * parallel: N single-threaded searches beat one N-threaded search across
   * independent positions.
   */
  threads?: number;
  /** Transposition table size, MB. */
  hashMb?: number;
  /** How long to wait for a single position before giving up, ms. */
  timeoutMs?: number;
  /**
   * Ceiling on a single position's search, ms. The engine returns its best
   * answer so far rather than running to full depth, so one sharp middlegame
   * cannot stall a whole game's analysis.
   */
  moveTimeMs?: number;
};

export type PositionAnalysis = {
  /** Best move in UCI notation, or undefined in a finished position. */
  bestMove: string | undefined;
  /**
   * The engine's expected continuation, space-separated UCI, beginning with
   * `bestMove`. The score is the assessment at the END of this line, so
   * without it the reasoning behind every evaluation is discarded.
   */
  bestLine: string | undefined;
  /** Evaluation from the perspective of the side to move. */
  score: Score;
  depth: number;
};

export const DEFAULT_DEPTH = 18;

export class EngineError extends Error {}

export class UciEngine {
  private process: ChildProcessWithoutNullStreams | undefined;
  private reader: readline.Interface | undefined;
  private listeners = new Set<(line: string) => void>();
  /** Serialises analyse() calls; see the note there. */
  private queue: Promise<void> = Promise.resolve();
  /** Waiters to reject if the process dies underneath them. */
  private pending = new Set<(error: EngineError) => void>();
  private readonly options: Required<EngineOptions>;

  constructor(options: EngineOptions = {}) {
    this.options = {
      path: options.path ?? process.env.STOCKFISH_PATH ?? "stockfish",
      depth: options.depth ?? DEFAULT_DEPTH,
      threads: options.threads ?? 1,
      hashMb: options.hashMb ?? 128,
      // Generous: a sharp middlegame at depth 18 can take far longer than a
      // quiet one, and a timeout here costs the whole game's analysis. This
      // is a guard against a hung engine, not a search budget.
      timeoutMs: options.timeoutMs ?? 120_000,
      moveTimeMs: options.moveTimeMs ?? 5_000,
    };
  }

  get depth(): number {
    return this.options.depth;
  }

  async start(): Promise<void> {
    if (this.process) return;

    this.process = spawn(this.options.path, [], { stdio: "pipe" });

    // spawn reports a missing binary asynchronously, so this cannot be a
    // try/catch: without it a missing Stockfish would stall for the whole
    // timeout before anyone learned why.
    let spawnError: EngineError | undefined;
    this.process.on("error", (cause: NodeJS.ErrnoException) => {
      spawnError =
        cause.code === "ENOENT"
          ? new EngineError(
              `Could not find the engine at "${this.options.path}". Install it with: brew install stockfish`,
            )
          : new EngineError(`Engine failed: ${cause.message}`);
      this.dispose();
    });

    this.reader = readline.createInterface({ input: this.process.stdout });
    this.reader.on("line", (line) => {
      for (const listener of [...this.listeners]) listener(line);
    });

    try {
      await this.handshake();
    } catch (cause) {
      // A spawn failure surfaces here as the handshake never completing;
      // report the real reason rather than "did not respond".
      throw spawnError ?? cause;
    }
  }

  private async handshake(): Promise<void> {
    this.send("uci");
    await this.waitFor((line) => line === "uciok");

    // Threads before Hash: Stockfish sizes some internal structures per
    // thread when the table is allocated.
    this.send(`setoption name Threads value ${this.options.threads}`);
    this.send(`setoption name Hash value ${this.options.hashMb}`);

    this.send("isready");
    await this.waitFor((line) => line === "readyok");
  }

  /**
   * Tell the engine a new game has begun, clearing the transposition table.
   *
   * Called at game boundaries only. Keeping the table warm *within* a game is
   * a large speedup, since consecutive positions share almost all their tree.
   */
  async newGame(): Promise<void> {
    this.send("ucinewgame");
    this.send("isready");
    await this.waitFor((line) => line === "readyok");
  }

  /**
   * Analyse one position.
   *
   * Calls are serialised: one engine speaks one conversation at a time, and
   * two overlapping searches on one stdin would interleave their `position`
   * and `go` commands and return each other's evaluations.
   */
  analyse(fen: string): Promise<PositionAnalysis> {
    const run = this.queue.then(
      () => this.analyseNow(fen),
      () => this.analyseNow(fen),
    );
    // Keep the chain alive regardless of this call's outcome.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async analyseNow(fen: string): Promise<PositionAnalysis> {
    if (!this.process) throw new EngineError("Engine is not running");

    let score: Score | undefined;
    let depth = 0;
    let bestLine: string | undefined;

    const collect = (line: string) => {
      if (!line.startsWith("info ")) return;
      const parsed = parseInfo(line);
      if (parsed) {
        score = parsed.score;
        depth = parsed.depth;
        // Kept only when present: the deepest line wins, and a line without a
        // pv must not erase one already captured at the same depth.
        if (parsed.line) bestLine = parsed.line;
      }
    };

    this.listeners.add(collect);
    try {
      this.send(`position fen ${fen}`);
      // Whichever comes first: the target depth, or the per-position ceiling.
      this.send(
        `go depth ${this.options.depth} movetime ${this.options.moveTimeMs}`,
      );

      let best: string;
      try {
        best = await this.waitFor((line) => line.startsWith("bestmove"));
      } catch (cause) {
        // The search is still running. Stop it and wait for its bestmove to
        // drain, or the next analyse() would resolve on this position's
        // result and store one position's evaluation under another's.
        await this.abortSearch();
        throw cause;
      }

      if (!score) {
        throw new EngineError(`Engine returned no evaluation for: ${fen}`);
      }

      const move = best.split(/\s+/)[1];
      return {
        bestMove: move && move !== "(none)" ? move : undefined,
        bestLine,
        score,
        depth,
      };
    } finally {
      this.listeners.delete(collect);
    }
  }

  /**
   * Stop a search that outran its timeout and drain the `bestmove` it still
   * owes us, so the reply cannot be mistaken for the next position's.
   */
  private async abortSearch(): Promise<void> {
    if (!this.process?.stdin.writable) return;

    try {
      this.send("stop");
      await this.waitForWithTimeout(
        (line) => line.startsWith("bestmove"),
        2_000,
      );
    } catch {
      // The engine is unresponsive rather than merely slow. Replace it: a
      // process in an unknown state cannot be trusted for the next position.
      this.dispose();
    }
  }

  private send(command: string): void {
    if (!this.process?.stdin.writable) {
      throw new EngineError("Engine is not accepting commands");
    }
    this.process.stdin.write(`${command}\n`);
  }

  private waitFor(predicate: (line: string) => boolean): Promise<string> {
    return this.waitForWithTimeout(predicate, this.options.timeoutMs);
  }

  private waitForWithTimeout(
    predicate: (line: string) => boolean,
    timeoutMs: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new EngineError(`Engine did not respond within ${timeoutMs}ms`));
      }, timeoutMs);

      const listener = (line: string) => {
        if (!predicate(line)) return;
        cleanup();
        resolve(line);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(listener);
        this.pending.delete(fail);
      };

      // Called if the process dies while this is waiting, so a crash surfaces
      // immediately instead of after a full timeout of dead waiting.
      const fail = (error: EngineError) => {
        cleanup();
        reject(error);
      };

      this.pending.add(fail);
      this.listeners.add(listener);
    });
  }

  dispose(): void {
    if (!this.process) return;
    const child = this.process;
    this.process = undefined;

    // Fail anything still waiting, rather than leaving it to time out against
    // a process that is already gone.
    for (const fail of [...this.pending]) {
      fail(new EngineError("Engine stopped while waiting for a reply"));
    }
    this.pending.clear();
    this.listeners.clear();
    this.reader?.close();
    this.reader = undefined;

    try {
      if (child.stdin.writable) child.stdin.write("quit\n");
    } catch {
      // Already gone; the kill below is the backstop.
    }
    child.kill();
  }
}

/**
 * Read an `info` line's score and depth.
 *
 * Lines without a score (`info string ...`, `currmove` updates) are ignored,
 * as are lower-depth lines from a multipv search beyond the first.
 */
export function parseInfo(
  line: string,
): { score: Score; depth: number; line: string | undefined } | undefined {
  // Only the principal variation carries the evaluation we want.
  const multipv = /\bmultipv (\d+)/.exec(line);
  if (multipv && multipv[1] !== "1") return undefined;

  const depthMatch = /\bdepth (\d+)/.exec(line);
  const mateMatch = /\bscore mate (-?\d+)/.exec(line);
  const cpMatch = /\bscore cp (-?\d+)/.exec(line);

  if (!depthMatch) return undefined;
  const depth = Number(depthMatch[1]);

  // The continuation the engine expects, already computed by the search and
  // reported at no extra cost. `pv` is always last on the line, so everything
  // after the marker is the variation.
  const pvMatch = /\bpv (.+)$/.exec(line);
  const bestLine = pvMatch?.[1]?.trim() || undefined;

  if (mateMatch) {
    return {
      score: { kind: "mate", moves: Number(mateMatch[1]) },
      depth,
      line: bestLine,
    };
  }
  if (cpMatch) {
    return {
      score: { kind: "cp", cp: Number(cpMatch[1]) },
      depth,
      line: bestLine,
    };
  }
  return undefined;
}
