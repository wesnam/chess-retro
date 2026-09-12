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
};

export type PositionAnalysis = {
  /** Best move in UCI notation, or undefined in a finished position. */
  bestMove: string | undefined;
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
  private readonly options: Required<EngineOptions>;

  constructor(options: EngineOptions = {}) {
    this.options = {
      path: options.path ?? process.env.STOCKFISH_PATH ?? "stockfish",
      depth: options.depth ?? DEFAULT_DEPTH,
      threads: options.threads ?? 1,
      hashMb: options.hashMb ?? 128,
      timeoutMs: options.timeoutMs ?? 30_000,
    };
  }

  get depth(): number {
    return this.options.depth;
  }

  async start(): Promise<void> {
    if (this.process) return;

    try {
      this.process = spawn(this.options.path, [], { stdio: "pipe" });
    } catch (cause) {
      throw new EngineError(`Could not start ${this.options.path}: ${cause}`);
    }

    this.process.on("error", () => {
      // Surfaced to callers as a timeout on the pending command; the process
      // is replaced rather than taking the whole job down with it.
      this.dispose();
    });

    this.reader = readline.createInterface({ input: this.process.stdout });
    this.reader.on("line", (line) => {
      for (const listener of [...this.listeners]) listener(line);
    });

    await this.handshake();
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

  async analyse(fen: string): Promise<PositionAnalysis> {
    if (!this.process) throw new EngineError("Engine is not running");

    let score: Score | undefined;
    let depth = 0;

    const collect = (line: string) => {
      if (!line.startsWith("info ")) return;
      const parsed = parseInfo(line);
      if (parsed) {
        score = parsed.score;
        depth = parsed.depth;
      }
    };

    this.listeners.add(collect);
    try {
      this.send(`position fen ${fen}`);
      this.send(`go depth ${this.options.depth}`);
      const best = await this.waitFor((line) => line.startsWith("bestmove"));

      if (!score) {
        throw new EngineError(`Engine returned no evaluation for: ${fen}`);
      }

      const move = best.split(/\s+/)[1];
      return {
        bestMove: move && move !== "(none)" ? move : undefined,
        score,
        depth,
      };
    } finally {
      this.listeners.delete(collect);
    }
  }

  private send(command: string): void {
    if (!this.process?.stdin.writable) {
      throw new EngineError("Engine is not accepting commands");
    }
    this.process.stdin.write(`${command}\n`);
  }

  private waitFor(predicate: (line: string) => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new EngineError(`Engine did not respond within ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);

      const listener = (line: string) => {
        if (!predicate(line)) return;
        cleanup();
        resolve(line);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(listener);
      };

      this.listeners.add(listener);
    });
  }

  dispose(): void {
    if (!this.process) return;
    const child = this.process;
    this.process = undefined;

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
): { score: Score; depth: number } | undefined {
  // Only the principal variation carries the evaluation we want.
  const multipv = /\bmultipv (\d+)/.exec(line);
  if (multipv && multipv[1] !== "1") return undefined;

  const depthMatch = /\bdepth (\d+)/.exec(line);
  const mateMatch = /\bscore mate (-?\d+)/.exec(line);
  const cpMatch = /\bscore cp (-?\d+)/.exec(line);

  if (!depthMatch) return undefined;
  const depth = Number(depthMatch[1]);

  if (mateMatch) {
    return { score: { kind: "mate", moves: Number(mateMatch[1]) }, depth };
  }
  if (cpMatch) {
    return { score: { kind: "cp", cp: Number(cpMatch[1]) }, depth };
  }
  return undefined;
}
