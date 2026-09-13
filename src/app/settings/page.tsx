import { getDb } from "@/db/client";
import { getCorpusLimit, getUsername } from "@/settings/settings";
import { SettingsForm } from "./SettingsForm";
import { coachFromEnv } from "@/insights/anthropic";

// The settings page reads live database state on every request.
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const db = getDb();

  return (
    <>
      <h1>Settings</h1>
      <p className="lede">
        Tell chess-retro whose games to study. Everything stays on this machine.
      </p>
      <SettingsForm
        username={getUsername(db) ?? ""}
        corpusLimit={getCorpusLimit(db)}
      />
      <Coaching />
    </>
  );
}

/**
 * What written coaching is, and whether it is on.
 *
 * Lives here rather than on the dashboard because it is configuration, and
 * because the dashboard renders nothing at all without a key — which makes the
 * feature undiscoverable to exactly the people who have not enabled it.
 *
 * Read from the environment rather than stored: the key is a deployment
 * concern, not a per-user setting, and a field to paste it into would put a
 * credential in the database and on screen.
 */
function Coaching() {
  // The same resolver the coach itself uses, so this cannot claim the
  // feature is on while the dashboard finds no provider.
  const enabled = coachFromEnv() !== undefined;

  return (
    <section className="card settings-coaching">
      <h2>Written coaching</h2>
      <p className={enabled ? "status-on" : "status-off"}>
        {enabled ? "On" : "Off"}
      </p>
      <p>
        A short paragraph on each weakness, written by Claude from the
        statistics already on your dashboard — what the pattern is and why it
        keeps happening. It never changes the ranking: the numbers are computed
        before the model is called, and it only puts them into words.
      </p>
      {enabled ? (
        <p className="hint">
          Enabled by <code>ANTHROPIC_API_KEY</code> in the environment. Answers
          are cached against the statistics that produced them, so revisiting
          the dashboard costs nothing and only a changed ranking is re-asked.
        </p>
      ) : (
        <p className="hint">
          Optional, and the dashboard is complete without it. To turn it on, set{" "}
          <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code> and restart.
          Keys come from{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
          >
            console.anthropic.com
          </a>{" "}
          — a pay-as-you-go API account, which is not the same as a Claude.ai
          subscription. It costs about 5¢ per distinct ranking.
        </p>
      )}
    </section>
  );
}
