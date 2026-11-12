#!/usr/bin/env node
// Margin pre-receive hook. Runs inside `git receive-pack` for every push.
//
// Rules
//  1. Only refs/heads/main may be updated, and never deleted.
//  2. In a group space, files under shared/<ownerId>/ are personal notes that
//     their owner has published into the group. Only the owner may add, remove
//     or re-level them. Another member may change the content only when the
//     owner has set the access level to "edit".
//
// The hook has no dependencies so that it runs anywhere `node` and `git` do.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const user = process.env.MARGIN_USER_ID ?? "";
const kind = process.env.MARGIN_SPACE_KIND ?? "";
const ZERO = /^0+$/;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function reject(message) {
  process.stderr.write(`margin: ${message}\n`);
  process.exit(1);
}

/** Reads the sharing header of a published note at a given commit. */
function sharing(commit, path) {
  let text;
  try {
    text = git(["cat-file", "blob", `${commit}:${path}`]);
  } catch {
    return null;
  }
  if (path.endsWith(".excalidraw")) {
    try {
      const m = JSON.parse(text).margin ?? {};
      return { owner: String(m.sharedOwner ?? ""), access: String(m.sharedAccess ?? "") };
    } catch {
      return null;
    }
  }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const pick = (key) => {
    const m = fm[1].match(new RegExp(`^${key}:\\s*["']?([A-Za-z0-9_-]+)["']?\\s*$`, "m"));
    return m ? m[1] : "";
  };
  return { owner: pick("sharedOwner"), access: pick("sharedAccess") };
}

const lines = readFileSync(0, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
  const [oldRev, newRev, ref] = line.split(" ");
  if (ref !== "refs/heads/main") reject(`only the main branch is synced (got ${ref})`);
  if (ZERO.test(newRev)) reject("the main branch cannot be deleted");
  if (kind !== "g") continue;

  const base = ZERO.test(oldRev) ? EMPTY_TREE : oldRev;
  const out = git(["diff-tree", "-r", "--no-renames", "--name-status", "-z", base, newRev]);
  const parts = out.split("\0").filter(Boolean);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i];
    const path = parts[i + 1];
    if (!path.startsWith("shared/")) continue;
    const owner = path.split("/")[1] ?? "";
    if (owner === user) continue;
    if (status !== "M") reject(`${path} belongs to another member; only they can share or unshare it`);
    const was = sharing(base, path);
    const now = sharing(newRev, path);
    if (!was || was.access !== "edit") reject(`${path} is shared as view-only`);
    if (!now || now.access !== "edit" || now.owner !== was.owner) {
      reject(`${path}: only the owner can change who may edit this note`);
    }
  }
}
process.exit(0);
