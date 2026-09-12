"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import {
  DEFAULT_CORPUS_LIMIT,
  setCorpusLimit,
  setUsername,
} from "@/settings/settings";

export type SettingsFormState = {
  status: "idle" | "ok" | "error";
  message?: string;
};

export async function saveSettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const username = String(formData.get("username") ?? "");
  const rawLimit = String(formData.get("corpusLimit") ?? "");

  try {
    const db = getDb();
    const saved = setUsername(db, username);

    const limit = Number.parseInt(rawLimit, 10);
    setCorpusLimit(db, Number.isFinite(limit) ? limit : DEFAULT_CORPUS_LIMIT);

    revalidatePath("/settings");
    return { status: "ok", message: `Saved. Tracking games for ${saved}.` };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not save settings.",
    };
  }
}
