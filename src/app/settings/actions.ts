"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import {
  DEFAULT_CORPUS_LIMIT,
  isValidUsername,
  normalizeUsername,
  saveUsernameAndLimit,
} from "@/settings/settings";

export type SettingsFormState = {
  status: "idle" | "ok" | "error";
  message?: string;
};

export async function saveSettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const rawUsername = String(formData.get("username") ?? "");
  const rawLimit = String(formData.get("corpusLimit") ?? "");

  // Validate everything before writing anything. A half-applied save would
  // report an error while leaving the app configured, which is worse than
  // either outcome on its own.
  const username = normalizeUsername(rawUsername);
  if (!isValidUsername(username)) {
    return {
      status: "error",
      message: `Not a valid chess.com username: "${rawUsername}"`,
    };
  }

  const limit = parseCorpusLimit(rawLimit);
  if (limit === undefined) {
    return {
      status: "error",
      message: "Games to analyse must be a whole number of at least 1.",
    };
  }

  try {
    const db = getDb();
    saveUsernameAndLimit(db, username, limit);
    revalidatePath("/settings");
    return { status: "ok", message: `Saved. Tracking games for ${username}.` };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Could not save settings.",
    };
  }
}

/**
 * An empty field falls back to the default; anything else must parse cleanly
 * as a positive integer. `Number.parseInt` is deliberately avoided: it accepts
 * a numeric prefix, so "12abc" would become 12 and "1e9" would become 1.
 */
function parseCorpusLimit(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return DEFAULT_CORPUS_LIMIT;

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}
