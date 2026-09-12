import Link from "next/link";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";

// Reads live database state on every request.
export const dynamic = "force-dynamic";

export default function GamesPage() {
  const username = getUsername(getDb());

  return (
    <>
      <h1>Games</h1>
      <p className="lede">Every game chess-retro has downloaded.</p>

      <div className="empty">
        {username ? (
          <p>
            No games downloaded yet for <strong>{username}</strong>.
          </p>
        ) : (
          <p>
            <Link href="/settings">Configure a username</Link> to download
            games.
          </p>
        )}
      </div>
    </>
  );
}
