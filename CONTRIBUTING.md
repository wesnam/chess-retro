# Contributing

Thanks for looking. This is early-development software — interfaces and the database schema still
move, and a schema change can cost a re-analysis of your corpus.

## Getting set up

See [Getting started](README.md#getting-started) in the README. In short: `npm install`,
`brew install stockfish`, `npm run dev`.

## Before opening a pull request

```sh
npm run typecheck
npm test
npm run build
```

All three run in CI and all three must pass. If you touched the engine or the puzzle importer, also
run `npm run test:slow` — those tests spawn a real Stockfish and hit the network, which is why they
are excluded from the default run.

## How this codebase is written

[README's Development notes](README.md#development-notes) is the real standards document. It records
the non-obvious rules and, more usefully, *why* each one exists — most were learned by getting it
wrong first. Worth reading before a substantial change.

A few conventions that are easy to miss:

- **Tests live beside the code** as `*.test.ts`. Slow ones are `*.slow.test.ts`.
- **Logic comes out of components** into pure, directly-tested modules — see `weakness/copy.ts` or
  `analysis/format-progress.ts`. Components are wiring.
- **Comments say why, not what.** A comment restating the code is noise; one explaining a decision
  that looks wrong until you know the reason is the point.
- **Engine scores are normalised to the mover's perspective at write time.** This is the single
  easiest thing in the project to get wrong, and it silently inverts every number downstream.

## Licence

By contributing you agree your work is licensed under **GPL-3.0-or-later**, like the rest of the
project. That licence is not a preference — Stockfish and chessground are both GPL, and no
permissively licensed chess engine exists. See [NOTICE](NOTICE).
