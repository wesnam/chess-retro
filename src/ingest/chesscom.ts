/**
 * chess.com's public read-only API. No key, no auth.
 *
 * It rejects requests without a descriptive User-Agent with 403, so the header
 * below is mandatory rather than polite.
 */

export const USER_AGENT =
  "chess-retro/0.1 (local chess analysis tool; +https://github.com/wesnam/chess-retro)";

const API_BASE = "https://api.chess.com/pub";

export type ChesscomPlayer = {
  rating?: number;
  result?: string;
  username?: string;
};

export type ChesscomGame = {
  url?: string;
  pgn?: string;
  time_control?: string;
  time_class?: string;
  end_time?: number;
  rated?: boolean;
  rules?: string;
  uuid?: string;
  white?: ChesscomPlayer;
  black?: ChesscomPlayer;
  accuracies?: { white?: number; black?: number };
};

export type ChesscomArchive = { games?: ChesscomGame[] };

export class ChesscomError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ChesscomError";
  }
}

export type Fetcher = typeof fetch;

async function getJson<T>(url: string, fetcher: Fetcher): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
  } catch (cause) {
    throw new ChesscomError(
      `Could not reach chess.com. Check your connection. (${String(cause)})`,
    );
  }

  if (response.status === 404) {
    throw new ChesscomError("No such chess.com user.", 404);
  }
  if (response.status === 429) {
    throw new ChesscomError(
      "chess.com is rate-limiting this sync. Wait a minute and try again.",
      429,
    );
  }
  if (!response.ok) {
    throw new ChesscomError(
      `chess.com returned ${response.status} ${response.statusText}.`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

/** Archive month identifier, "YYYY-MM". */
export type ArchiveMonth = string;

export function monthFromArchiveUrl(url: string): ArchiveMonth | undefined {
  const match = /\/(\d{4})\/(\d{2})$/.exec(url);
  return match ? `${match[1]}-${match[2]}` : undefined;
}

export function currentMonth(now: Date = new Date()): ArchiveMonth {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Every month for which this player has games, oldest first. This is the only
 * way to know what exists — months with no games are simply absent.
 */
export async function listArchiveMonths(
  username: string,
  fetcher: Fetcher = fetch,
): Promise<ArchiveMonth[]> {
  const data = await getJson<{ archives?: string[] }>(
    `${API_BASE}/player/${encodeURIComponent(username)}/games/archives`,
    fetcher,
  );

  return (data.archives ?? [])
    .map(monthFromArchiveUrl)
    .filter((m): m is ArchiveMonth => m !== undefined);
}

export async function fetchArchive(
  username: string,
  month: ArchiveMonth,
  fetcher: Fetcher = fetch,
): Promise<ChesscomGame[]> {
  const [year, mm] = month.split("-");
  const data = await getJson<ChesscomArchive>(
    `${API_BASE}/player/${encodeURIComponent(username)}/games/${year}/${mm}`,
    fetcher,
  );
  return data.games ?? [];
}
