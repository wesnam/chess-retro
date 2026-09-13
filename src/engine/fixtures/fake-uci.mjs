#!/usr/bin/env node
/**
 * A fake UCI engine, for testing the protocol layer without Stockfish.
 *
 * Real Stockfish lives in the slow suite. This exists so the parts that are
 * easy to get wrong and expensive to reproduce — an infinite search that only
 * stops when told, and the `bestmove` still owed after a `stop` — are covered
 * by the fast suite on every run.
 *
 * Behaviour is driven by FAKE_UCI_MODE:
 *   normal  — deepens forever until stopped (the default)
 *   silent  — acknowledges `go` but never emits an info line or a bestmove
 */
import readline from "node:readline";

const mode = process.env.FAKE_UCI_MODE ?? "normal";
const say = (line) => process.stdout.write(`${line}\n`);

let timer;
let depth = 0;

const stopSearch = () => {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
  // The bestmove is still owed after a stop. Emitting it is the whole point
  // of the drain the caller performs.
  say("bestmove e2e4");
};

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  if (line === "uci") {
    say("id name fake-uci");
    say("uciok");
    return;
  }
  if (line === "isready") {
    say("readyok");
    return;
  }
  if (line.startsWith("go")) {
    if (mode === "silent") return;
    depth = 0;
    timer = setInterval(() => {
      depth += 1;
      say(
        `info depth ${depth} seldepth ${depth} multipv 1 score cp ${depth * 3} nodes 1000 pv e2e4 e7e5 g1f3`,
      );
    }, 5);
    return;
  }
  if (line === "stop") {
    stopSearch();
    return;
  }
  if (line === "quit") {
    stopSearch();
    process.exit(0);
  }
});
