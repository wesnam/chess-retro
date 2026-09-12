import { getDb } from "@/db/client";
import { getCorpusLimit, getUsername } from "@/settings/settings";
import { SettingsForm } from "./SettingsForm";

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
    </>
  );
}
