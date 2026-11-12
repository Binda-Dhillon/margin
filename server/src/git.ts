import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config, type SpaceRef } from "./config.js";
import { db, isMember, memberIds } from "./db.js";
import { userFromHeaders, type SessionUser } from "./auth.js";
import { emitTo } from "./events.js";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function repoPath(space: SpaceRef): string {
  if (!ID_RE.test(space.id)) throw new Error("Bad space id");
  return path.join(config.dataDir, "repos", space.kind === "u" ? "users" : "groups", `${space.id}.git`);
}

function git(repo: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd: repo,
    input,
    env: { ...process.env, GIT_DIR: repo, ...env },
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

const HOOK = `#!/bin/sh
# Installed by Margin. Enforces who may change shared notes in a group space.
if [ -z "$MARGIN_HOOK" ]; then exit 0; fi
exec node "$MARGIN_HOOK"
`;

/**
 * Every space (a user's personal notes, or a group) is one bare git repository.
 * It is created with a first commit so that a fresh clone always has a `main`.
 */
export function ensureRepo(space: SpaceRef, meta: { name: string; createdBy: { name: string; email: string } }) {
  const repo = repoPath(space);
  if (fs.existsSync(path.join(repo, "HEAD"))) {
    installHook(repo);
    return;
  }
  fs.mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "--bare", "--initial-branch=main", repo], { stdio: "ignore" });
  git(repo, ["config", "receive.denyNonFastForwards", "true"]);
  git(repo, ["config", "receive.denyDeletes", "true"]);
  git(repo, ["config", "core.logAllRefUpdates", "true"]);
  installHook(repo);

  const spaceJson =
    JSON.stringify(
      { margin: 1, kind: space.kind === "u" ? "personal" : "group", id: space.id, name: meta.name },
      null,
      2,
    ) + "\n";
  const blob = git(repo, ["hash-object", "-w", "--stdin"], spaceJson);
  const inner = git(repo, ["mktree"], `100644 blob ${blob}\tspace.json\n`);
  const tree = git(repo, ["mktree"], `040000 tree ${inner}\t.margin\n`);
  const ident = {
    GIT_AUTHOR_NAME: meta.createdBy.name || "Margin",
    GIT_AUTHOR_EMAIL: meta.createdBy.email || "margin@localhost",
    GIT_COMMITTER_NAME: meta.createdBy.name || "Margin",
    GIT_COMMITTER_EMAIL: meta.createdBy.email || "margin@localhost",
  };
  const commit = git(repo, ["commit-tree", tree, "-m", `Create ${meta.name}`], undefined, ident);
  git(repo, ["update-ref", "refs/heads/main", commit]);
}

function installHook(repo: string) {
  const file = path.join(repo, "hooks", "pre-receive");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== HOOK) {
    fs.writeFileSync(file, HOOK, { mode: 0o755 });
  }
}

export function removeRepo(space: SpaceRef) {
  const repo = repoPath(space);
  if (!fs.existsSync(repo)) return;
  const trash = path.join(config.dataDir, "repos", "trash");
  fs.mkdirSync(trash, { recursive: true });
  fs.renameSync(repo, path.join(trash, `${space.kind}-${space.id}-${Date.now()}.git`));
}

function headOf(repo: string): string {
  try {
    return git(repo, ["rev-parse", "refs/heads/main"]);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- auth ----

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function userFromBasicAuth(header: string | undefined): SessionUser | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const token = decoded.slice(decoded.indexOf(":") + 1);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT t.id AS token_id, u.id, u.name, u.email, u.image FROM tokens t
       JOIN user u ON u.id = t.user_id WHERE t.hash = ?`,
    )
    .get(hashToken(token)) as (SessionUser & { token_id: string }) | undefined;
  if (!row) return null;
  db.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?").run(Date.now(), row.token_id);
  return { id: row.id, name: row.name, email: row.email, image: row.image };
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  return headers;
}

// ----------------------------------------------------- smart HTTP git ----

const SERVICES = new Set(["git-upload-pack", "git-receive-pack"]);

function pktLine(s: string): string {
  return (s.length + 4).toString(16).padStart(4, "0") + s;
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(body);
}

/**
 * Serves `/git/u/<userId>.git/...` and `/git/g/<groupId>.git/...` with git's
 * smart HTTP protocol by handing the request to the real `git` binary. The
 * browser client (isomorphic-git) and any ordinary git client use the same URL.
 */
export async function handleGit(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const m = url.pathname.match(/^\/git\/(u|g)\/([A-Za-z0-9_-]{1,64})\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/);
  if (!m) return send(res, 404, "Not found");
  const space: SpaceRef = { kind: m[1] as "u" | "g", id: m[2] };
  const action = m[3];

  const user = userFromBasicAuth(req.headers.authorization) ?? (await userFromHeaders(toHeaders(req)));
  if (!user) {
    // A browser would pop up its own password box on WWW-Authenticate, so the
    // web client marks its requests and gets a plain 401 instead.
    const fromApp = req.headers["x-margin-client"] === "web";
    return send(res, 401, "Sign in to access this space", fromApp ? {} : { "WWW-Authenticate": 'Basic realm="Margin"' });
  }
  const allowed = space.kind === "u" ? user.id === space.id : isMember(space.id, user.id);
  if (!allowed) return send(res, 403, "You do not have access to this space");

  const repo = repoPath(space);
  if (!fs.existsSync(path.join(repo, "HEAD"))) return send(res, 404, "Space not found");

  if (action === "info/refs") {
    const service = url.searchParams.get("service") ?? "";
    if (req.method !== "GET" || !SERVICES.has(service)) return send(res, 400, "Unsupported service");
    res.writeHead(200, {
      "Content-Type": `application/x-${service}-advertisement`,
      "Cache-Control": "no-cache, max-age=0, must-revalidate",
    });
    res.write(pktLine(`# service=${service}\n`) + "0000");
    const child = spawn("git", [service.slice(4), "--stateless-rpc", "--advertise-refs", repo]);
    child.stdout.pipe(res);
    child.on("error", () => res.end());
    return;
  }

  if (req.method !== "POST" || !SERVICES.has(action)) return send(res, 400, "Unsupported request");
  const isPush = action === "git-receive-pack";
  const before = isPush ? headOf(repo) : "";

  res.writeHead(200, {
    "Content-Type": `application/x-${action}-result`,
    "Cache-Control": "no-cache, max-age=0, must-revalidate",
  });
  const child = spawn("git", [action.slice(4), "--stateless-rpc", repo], {
    env: {
      ...process.env,
      MARGIN_HOOK: config.hookPath,
      MARGIN_USER_ID: user.id,
      MARGIN_USER_NAME: user.name,
      MARGIN_SPACE_KIND: space.kind,
      MARGIN_SPACE_ID: space.id,
    },
  });
  const body = req.headers["content-encoding"] === "gzip" ? req.pipe(zlib.createGunzip()) : req;
  body.pipe(child.stdin);
  child.stdin.on("error", () => {});
  child.stdout.pipe(res);
  child.on("error", () => res.end());
  child.on("close", () => {
    if (!isPush) return;
    const after = headOf(repo);
    if (after && after !== before) {
      const audience = space.kind === "u" ? [space.id] : memberIds(space.id);
      emitTo(audience, {
        type: "repo",
        space: `${space.kind}:${space.id}`,
        head: after,
        by: { id: user.id, name: user.name },
      });
    }
  });
}
