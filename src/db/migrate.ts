/**
 * Schema DDL, applied on every open. Every statement is IF NOT EXISTS, so this
 * is idempotent and safe to run against an existing database.
 *
 * This mirrors `schema.ts`, which is the source of truth for query building.
 * A change in one must be made in the other; `schema.test.ts` asserts that the
 * tables and indexes named here all exist after an open.
 */
export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id                   TEXT PRIMARY KEY,
  user                 TEXT NOT NULL,
  url                  TEXT,
  pgn                  TEXT NOT NULL,
  time_class           TEXT NOT NULL,
  time_control         TEXT,
  user_color           TEXT NOT NULL,
  user_result          TEXT NOT NULL,
  user_result_raw      TEXT,
  user_rating          INTEGER,
  opponent_username    TEXT,
  opponent_rating      INTEGER,
  rated                INTEGER,
  end_time             INTEGER NOT NULL,
  eco                  TEXT,
  opening_name         TEXT,
  opening_family       TEXT,
  analysis_status      TEXT NOT NULL DEFAULT 'pending',
  analysis_error       TEXT,
  analysis_depth       INTEGER,
  analyzed_at          INTEGER,
  accuracy_user        REAL,
  cc_accuracy_user     REAL,
  cc_accuracy_opponent REAL
);
CREATE INDEX IF NOT EXISTS games_user_tc_end     ON games (user, time_class, end_time);
CREATE INDEX IF NOT EXISTS games_user_status     ON games (user, analysis_status);
CREATE INDEX IF NOT EXISTS games_user_opening    ON games (user, time_class, opening_family);

CREATE TABLE IF NOT EXISTS moves (
  game_id         TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply             INTEGER NOT NULL,
  user            TEXT NOT NULL,
  time_class      TEXT NOT NULL,
  is_user_move    INTEGER NOT NULL,
  color           TEXT NOT NULL,
  fen_before      TEXT NOT NULL,
  san             TEXT NOT NULL,
  uci             TEXT NOT NULL,
  piece           TEXT NOT NULL,
  phase           TEXT,
  clock_ms        INTEGER,
  move_time_ms    INTEGER,
  eval_before     INTEGER,
  eval_after      INTEGER,
  mate_before     INTEGER,
  mate_after      INTEGER,
  best_move_uci   TEXT,
  cp_loss         INTEGER,
  win_pct_before  REAL,
  win_pct_after   REAL,
  move_accuracy   REAL,
  classification  TEXT,
  PRIMARY KEY (game_id, ply)
);
CREATE INDEX IF NOT EXISTS moves_user_tc_usermove_class ON moves (user, time_class, is_user_move, classification);
CREATE INDEX IF NOT EXISTS moves_user_tc_phase          ON moves (user, time_class, is_user_move, phase);
CREATE INDEX IF NOT EXISTS moves_user_tc_piece          ON moves (user, time_class, is_user_move, piece);
CREATE INDEX IF NOT EXISTS moves_game_ply               ON moves (game_id, ply);

CREATE TABLE IF NOT EXISTS move_motifs (
  game_id    TEXT NOT NULL,
  ply        INTEGER NOT NULL,
  user       TEXT NOT NULL,
  time_class TEXT NOT NULL,
  motif      TEXT NOT NULL,
  role       TEXT NOT NULL,
  PRIMARY KEY (game_id, ply, motif, role)
);
CREATE INDEX IF NOT EXISTS motifs_user_tc_role_motif ON move_motifs (user, time_class, role, motif);

CREATE TABLE IF NOT EXISTS sync_state (
  user          TEXT NOT NULL,
  archive_month TEXT NOT NULL,
  fetched_at    INTEGER NOT NULL,
  game_count    INTEGER NOT NULL DEFAULT 0,
  complete      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user, archive_month)
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user            TEXT NOT NULL,
  status          TEXT NOT NULL,
  depth           INTEGER NOT NULL,
  total_games     INTEGER NOT NULL DEFAULT 0,
  completed_games INTEGER NOT NULL DEFAULT 0,
  started_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS jobs_user_status ON analysis_jobs (user, status);

CREATE TABLE IF NOT EXISTS insights (
  input_hash TEXT PRIMARY KEY,
  user       TEXT NOT NULL,
  time_class TEXT NOT NULL,
  body       TEXT NOT NULL,
  model      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS insights_user_tc ON insights (user, time_class);

CREATE TABLE IF NOT EXISTS openings (
  uci_prefix TEXT PRIMARY KEY,
  eco        TEXT NOT NULL,
  name       TEXT NOT NULL,
  family     TEXT NOT NULL,
  ply_count  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS openings_ply ON openings (ply_count);

CREATE TABLE IF NOT EXISTS puzzles (
  id                TEXT PRIMARY KEY,
  fen               TEXT NOT NULL,
  moves_uci         TEXT NOT NULL,
  rating            INTEGER NOT NULL,
  rating_deviation  INTEGER,
  popularity        INTEGER NOT NULL,
  nb_plays          INTEGER,
  game_url          TEXT
);
CREATE INDEX IF NOT EXISTS puzzles_rating_pop ON puzzles (rating, popularity);

CREATE TABLE IF NOT EXISTS puzzle_themes (
  puzzle_id TEXT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  theme     TEXT NOT NULL,
  PRIMARY KEY (puzzle_id, theme)
);
CREATE INDEX IF NOT EXISTS puzzle_themes_theme ON puzzle_themes (theme);

CREATE TABLE IF NOT EXISTS puzzle_attempts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user             TEXT NOT NULL,
  puzzle_id        TEXT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  solved           INTEGER NOT NULL,
  served_for_theme TEXT,
  attempted_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_user_puzzle ON puzzle_attempts (user, puzzle_id);
CREATE INDEX IF NOT EXISTS attempts_user_theme  ON puzzle_attempts (user, served_for_theme);
`;
