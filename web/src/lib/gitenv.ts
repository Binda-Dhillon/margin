import LightningFS from "@isomorphic-git/lightning-fs";
import http from "isomorphic-git/http/web";
import type { GitEnv } from "../core/repo";

/**
 * Each signed-in user gets their own IndexedDB-backed filesystem in this
 * browser. Their clones of every space live under /spaces.
 */
export function createEnv(userId: string): GitEnv {
  const fs = new LightningFS(`margin-${userId}`);
  return {
    fs,
    http,
    baseUrl: window.location.origin,
    root: "/spaces",
    headers: { "X-Margin-Client": "web" },
  };
}

/** Removes this user's local copies from the browser (used on sign out). */
export async function wipeLocal(userId: string): Promise<void> {
  const names = [`margin-${userId}`, `margin-${userId}_lock`];
  await Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        }),
    ),
  );
}
