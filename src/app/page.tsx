import Link from "next/link";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";

// Reads live database state on every request.
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const username = getUsername(getDb());

  return (
    <>
      <h1>Your weaknesses</h1>
      <p className="lede">
        What you keep getting wrong, across every game — not just the last one.
      </p>

      {username ? (
        <div className="empty">
          <p>
            No games analysed yet for <strong>{username}</strong>.
          </p>
          <p>Syncing arrives in the next slice.</p>
        </div>
      ) : (
        <div className="empty">
          <p>No chess.com username configured yet.</p>
          <p>
            <Link href="/settings">Add one in settings</Link> to get started.
          </p>
        </div>
      )}
    </>
  );
}
