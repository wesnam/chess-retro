import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Two schema decisions here are load-bearing and deliberate:
 *
 * 1. Every game and move row carries `user` — the chess.com username it belongs
 *    to. The configured username can change, and two accounts' games must never
 *    blend into one set of conclusions.
 * 2. `user` and `timeClass` are denormalised onto `moves` and `moveMotifs`.
 *    Every aggregation filters on both, and joining across tens of thousands of
 *    move rows on each dashboard load is not acceptable.
 */

/** Key/value application settings. Holds the configured chess.com username. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const games = sqliteTable(
  "games",
  {
    /** chess.com game UUID. */
    id: text("id").primaryKey(),
    user: text("user").notNull(),
    url: text("url"),
    pgn: text("pgn").notNull(),
    /** bullet | blitz | rapid | daily */
    timeClass: text("time_class").notNull(),
    /** Raw chess.com time control, e.g. "600+5". */
    timeControl: text("time_control"),
    /** Which colour the configured user played: w | b */
    userColor: text("user_color").notNull(),
    /** Result from the user's perspective: win | loss | draw */
    userResult: text("user_result").notNull(),
    /** Raw chess.com result token for the user, e.g. "checkmated", "timeout". */
    userResultRaw: text("user_result_raw"),
    userRating: integer("user_rating"),
    opponentUsername: text("opponent_username"),
    opponentRating: integer("opponent_rating"),
    rated: integer("rated", { mode: "boolean" }),
    /** Unix seconds, from the PGN/API end time. */
    endTime: integer("end_time").notNull(),
    eco: text("eco"),
    openingName: text("opening_name"),
    openingFamily: text("opening_family"),
    /** pending | running | done | error */
    analysisStatus: text("analysis_status").notNull().default("pending"),
    analysisError: text("analysis_error"),
    /** Engine depth that produced this game's verdicts. */
    analysisDepth: integer("analysis_depth"),
    analyzedAt: integer("analyzed_at"),
    /** Our own accuracy figure for the user, from the Lichess method. */
    accuracyUser: real("accuracy_user"),
    /**
     * chess.com's own accuracy number, stored for side-by-side validation only.
     * This must NEVER enter an aggregate: mixing two accuracy formulas would
     * make the corpus methodologically incoherent.
     */
    ccAccuracyUser: real("cc_accuracy_user"),
    ccAccuracyOpponent: real("cc_accuracy_opponent"),
  },
  (t) => [
    index("games_user_tc_end").on(t.user, t.timeClass, t.endTime),
    index("games_user_status").on(t.user, t.analysisStatus),
    index("games_user_opening").on(t.user, t.timeClass, t.openingFamily),
  ],
);

export const moves = sqliteTable(
  "moves",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    /** 1-based half-move number. */
    ply: integer("ply").notNull(),
    // Denormalised for aggregation; see note at top of file.
    user: text("user").notNull(),
    timeClass: text("time_class").notNull(),
    /** True when this move was played by the configured user. */
    isUserMove: integer("is_user_move", { mode: "boolean" }).notNull(),
    /** Side to move: w | b */
    color: text("color").notNull(),
    fenBefore: text("fen_before").notNull(),
    san: text("san").notNull(),
    uci: text("uci").notNull(),
    /** Moving piece type: p | n | b | r | q | k */
    piece: text("piece").notNull(),
    /** opening | middlegame | endgame */
    phase: text("phase"),
    /** Clock reading after this move, milliseconds. */
    clockMs: integer("clock_ms"),
    /** Time spent on this move, milliseconds. */
    moveTimeMs: integer("move_time_ms"),
    /**
     * Evaluations in centipawns from the MOVER's perspective, normalised at
     * write time. UCI reports from the side-to-move's perspective, so
     * `evalAfter` is negated on the way in. Getting this wrong silently
     * inverts every number downstream.
     */
    evalBefore: integer("eval_before"),
    evalAfter: integer("eval_after"),
    /** Mate distances, stored separately from centipawns. */
    mateBefore: integer("mate_before"),
    mateAfter: integer("mate_after"),
    bestMoveUci: text("best_move_uci"),
    /** Centipawns lost by the mover; a bad move yields a large positive value. */
    cpLoss: integer("cp_loss"),
    winPctBefore: real("win_pct_before"),
    winPctAfter: real("win_pct_after"),
    moveAccuracy: real("move_accuracy"),
    /** best | excellent | good | inaccuracy | mistake | blunder */
    classification: text("classification"),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.ply] }),
    index("moves_user_tc_usermove_class").on(
      t.user,
      t.timeClass,
      t.isUserMove,
      t.classification,
    ),
    index("moves_user_tc_phase").on(t.user, t.timeClass, t.isUserMove, t.phase),
    index("moves_user_tc_piece").on(t.user, t.timeClass, t.isUserMove, t.piece),
    index("moves_game_ply").on(t.gameId, t.ply),
  ],
);

export const moveMotifs = sqliteTable(
  "move_motifs",
  {
    gameId: text("game_id").notNull(),
    ply: integer("ply").notNull(),
    // Denormalised for aggregation; see note at top of file.
    user: text("user").notNull(),
    timeClass: text("time_class").notNull(),
    /** Lichess theme string, e.g. "fork", "backRankMate". */
    motif: text("motif").notNull(),
    /**
     * missed  — the motif was available in the engine's best line and not played
     * played  — the user played it
     * allowed — the opponent's reply exploited it
     *
     * `missed` is what drives weakness detection.
     */
    role: text("role").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.ply, t.motif, t.role] }),
    index("motifs_user_tc_role_motif").on(
      t.user,
      t.timeClass,
      t.role,
      t.motif,
    ),
  ],
);

/** Which chess.com monthly archives have been fetched, for incremental sync. */
export const syncState = sqliteTable(
  "sync_state",
  {
    user: text("user").notNull(),
    /** Archive month as "YYYY-MM". */
    archiveMonth: text("archive_month").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    gameCount: integer("game_count").notNull().default(0),
    /**
     * False for the current month, which is still accumulating games and must
     * be re-checked on every sync.
     */
    complete: integer("complete", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.user, t.archiveMonth] })],
);

export const analysisJobs = sqliteTable(
  "analysis_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user: text("user").notNull(),
    /** running | paused | done | error */
    status: text("status").notNull(),
    depth: integer("depth").notNull(),
    totalGames: integer("total_games").notNull().default(0),
    completedGames: integer("completed_games").notNull().default(0),
    startedAt: integer("started_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
    error: text("error"),
  },
  (t) => [index("jobs_user_status").on(t.user, t.status)],
);

/** Cached LLM coaching output, keyed by a hash of the input payload. */
export const insights = sqliteTable(
  "insights",
  {
    /** sha256 of the serialised InsightRequest. */
    inputHash: text("input_hash").primaryKey(),
    user: text("user").notNull(),
    timeClass: text("time_class").notNull(),
    /** JSON payload returned by the model. */
    body: text("body").notNull(),
    model: text("model"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("insights_user_tc").on(t.user, t.timeClass)],
);

/** Lichess chess-openings (CC0), keyed by move-sequence prefix. */
export const openings = sqliteTable(
  "openings",
  {
    /** Space-separated UCI move prefix. */
    uciPrefix: text("uci_prefix").primaryKey(),
    eco: text("eco").notNull(),
    name: text("name").notNull(),
    /** Name before the first colon, e.g. "Sicilian Defense". */
    family: text("family").notNull(),
    plyCount: integer("ply_count").notNull(),
  },
  (t) => [index("openings_ply").on(t.plyCount)],
);

/** Lichess puzzle database (CC0). */
export const puzzles = sqliteTable(
  "puzzles",
  {
    id: text("id").primaryKey(),
    /**
     * The position BEFORE the opponent's setup move. The first entry of
     * `movesUci` must be applied before the puzzle is displayed, or every
     * puzzle shows one move too early.
     */
    fen: text("fen").notNull(),
    /** Space-separated UCI moves: [0] is the setup move, [1] is the solution. */
    movesUci: text("moves_uci").notNull(),
    rating: integer("rating").notNull(),
    ratingDeviation: integer("rating_deviation"),
    popularity: integer("popularity").notNull(),
    nbPlays: integer("nb_plays"),
    gameUrl: text("game_url"),
  },
  (t) => [index("puzzles_rating_pop").on(t.rating, t.popularity)],
);

export const puzzleThemes = sqliteTable(
  "puzzle_themes",
  {
    puzzleId: text("puzzle_id")
      .notNull()
      .references(() => puzzles.id, { onDelete: "cascade" }),
    /** Lichess theme string — the same vocabulary as `moveMotifs.motif`. */
    theme: text("theme").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.puzzleId, t.theme] }),
    index("puzzle_themes_theme").on(t.theme),
  ],
);

export const puzzleAttempts = sqliteTable(
  "puzzle_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user: text("user").notNull(),
    puzzleId: text("puzzle_id")
      .notNull()
      .references(() => puzzles.id, { onDelete: "cascade" }),
    solved: integer("solved", { mode: "boolean" }).notNull(),
    /** The theme this puzzle was served for, so improvement can be tracked. */
    servedForTheme: text("served_for_theme"),
    attemptedAt: integer("attempted_at").notNull(),
  },
  (t) => [
    index("attempts_user_puzzle").on(t.user, t.puzzleId),
    index("attempts_user_theme").on(t.user, t.servedForTheme),
  ],
);
