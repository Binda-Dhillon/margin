import git from "isomorphic-git";
import { mergeFile } from "./merge";
import type { Author } from "./types";

/**
 * One SpaceRepo is this device's clone of a space (a member's "folder").
 * It talks to the server with ordinary git over HTTP:
 *
 *   write()/remove()   change files in the working folder
 *   sync()             commit, pull (fast-forward or 3-way merge), push
 *
 * The same class runs in the browser (LightningFS on IndexedDB) and in Node
 * (the real filesystem, used by the tests).
 */

export interface GitEnv {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fs: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  http: any;
  /** Server origin, e.g. https://notes.example.org */
  baseUrl: string;
  /** Folder that holds one sub-folder per space. */
  root: string;
  headers?: Record<string, string>;
}

export interface SyncResult {
  /** Files in the working folder that changed because of other people's work. */
  changed: string[];
  /** Notes where both sides edited the same lines; the other version was kept beside ours. */
  conflicts: string[];
  /** Commit made from local edits, if there were any. */
  committed: string | null;
  pushed: boolean;
  head: string;
}

export interface CommitInfo {
  oid: string;
  message: string;
  authorName: string;
  authorEmail: string;
  time: number;
  parents: string[];
}

export class OfflineError extends Error {
  constructor(public result: SyncResult, cause?: unknown) {
    super("Could not reach the server");
    this.name = "OfflineError";
    this.cause = cause;
  }
}

export class AccessError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "AccessError";
  }
}

const decoder = new TextDecoder();

function isMissing(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "ENOENT" || code === "NotFoundError" || code === "ENOTDIR";
}

/**
 * isomorphic-git could not find a commit, tree or blob this copy refers to.
 * The copy no longer lines up with itself or the server, and only a fresh
 * download fixes it (see repairLocked).
 */
function isMissingObject(err: unknown): boolean {
  const e = err as { code?: string; data?: { what?: string } };
  return e?.code === "NotFoundError" && /^[0-9a-f]{40}$/.test(e.data?.what ?? "");
}

export class SpaceRepo {
  readonly dir: string;
  readonly url: string;
  private queue: Promise<unknown> = Promise.resolve();
  private dirty = new Set<string>();
  private opened = false;

  constructor(private env: GitEnv, readonly key: string, public author: Author) {
    const [kind, id] = key.split(":");
    this.dir = `${env.root}/${kind}-${id}`;
    this.url = `${env.baseUrl}/git/${kind}/${id}.git`;
  }

  private get pfs() {
    return this.env.fs.promises;
  }
  private get base() {
    return { fs: this.env.fs, dir: this.dir };
  }
  private get net() {
    return { ...this.base, http: this.env.http, url: this.url, headers: this.env.headers ?? {} };
  }

  /** All operations on one clone run strictly one after another. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // ------------------------------------------------------- filesystem ----

  private async exists(full: string): Promise<boolean> {
    try {
      await this.pfs.stat(full);
      return true;
    } catch {
      return false;
    }
  }

  private async mkdirp(full: string) {
    const parts = full.split("/").filter(Boolean);
    let current = full.startsWith("/") ? "" : ".";
    for (const part of parts) {
      current = current === "" ? `/${part}` : current === "." ? part : `${current}/${part}`;
      try {
        await this.pfs.mkdir(current);
      } catch (err) {
        if ((err as { code?: string }).code !== "EEXIST" && !(await this.exists(current))) throw err;
      }
    }
  }

  private async rmrf(full: string) {
    let names: string[];
    try {
      names = await this.pfs.readdir(full);
    } catch {
      try {
        await this.pfs.unlink(full);
      } catch {
        /* already gone */
      }
      return;
    }
    for (const name of names) {
      const child = `${full}/${name}`;
      const stat = await this.pfs.lstat(child);
      if (stat.isDirectory()) await this.rmrf(child);
      else await this.pfs.unlink(child);
    }
    await this.pfs.rmdir(full);
  }

  private async readRaw(path: string): Promise<string | null> {
    try {
      return (await this.pfs.readFile(`${this.dir}/${path}`, { encoding: "utf8" })) as string;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  private async writeRaw(path: string, content: string | null) {
    const full = `${this.dir}/${path}`;
    if (content === null) {
      try {
        await this.pfs.unlink(full);
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
      return;
    }
    await this.mkdirp(full.slice(0, full.lastIndexOf("/")));
    await this.pfs.writeFile(full, content, { encoding: "utf8" });
  }

  private async saveDirty() {
    await this.pfs.writeFile(`${this.dir}/.git/margin-dirty.json`, JSON.stringify([...this.dirty]), { encoding: "utf8" });
  }

  // ----------------------------------------------------------- public ----

  /** Clones the space on first use; afterwards just reopens the local folder. */
  open(): Promise<"cloned" | "existing"> {
    return this.run(async () => {
      if (this.opened) return "existing";
      const marker = `${this.dir}/.git/margin-cloned`;
      if (await this.exists(marker)) {
        try {
          const saved = await this.pfs.readFile(`${this.dir}/.git/margin-dirty.json`, { encoding: "utf8" });
          for (const p of JSON.parse(saved as string)) this.dirty.add(p);
        } catch {
          /* nothing pending */
        }
        this.opened = true;
        return "existing";
      }
      await this.rmrf(this.dir);
      await this.mkdirp(this.dir);
      try {
        await git.clone({ ...this.net, ref: "main", singleBranch: true, noTags: true });
      } catch (err) {
        await this.rmrf(this.dir).catch(() => undefined);
        throw this.translate(err);
      }
      await this.pfs.writeFile(marker, "1", { encoding: "utf8" });
      this.opened = true;
      return "cloned";
    });
  }

  /** Removes this device's copy (used when leaving a group). */
  destroy(): Promise<void> {
    return this.run(async () => {
      this.opened = false;
      await this.rmrf(this.dir);
    });
  }

  read(path: string): Promise<string | null> {
    return this.run(() => this.readRaw(path));
  }

  write(path: string, content: string): Promise<void> {
    return this.run(async () => {
      await this.writeRaw(path, content);
      this.dirty.add(path);
      await this.saveDirty();
    });
  }

  remove(path: string): Promise<void> {
    return this.run(async () => {
      await this.writeRaw(path, null);
      this.dirty.add(path);
      await this.saveDirty();
    });
  }

  /** Every file in the working folder, as repo-relative paths. */
  list(): Promise<string[]> {
    return this.run(async () => {
      const out: string[] = [];
      const walk = async (rel: string) => {
        const names: string[] = await this.pfs.readdir(rel ? `${this.dir}/${rel}` : this.dir);
        for (const name of names) {
          if (!rel && name === ".git") continue;
          const child = rel ? `${rel}/${name}` : name;
          const stat = await this.pfs.stat(`${this.dir}/${child}`);
          if (stat.isDirectory()) await walk(child);
          else out.push(child);
        }
      };
      await walk("");
      return out.sort();
    });
  }

  hasLocalChanges(): boolean {
    return this.dirty.size > 0;
  }

  head(): Promise<string> {
    return this.run(() => git.resolveRef({ ...this.base, ref: "refs/heads/main" }));
  }

  /** Commit local edits without contacting the server. */
  commit(message: string): Promise<string | null> {
    return this.run(() => this.commitLocked(message));
  }

  /**
   * Bring this folder and the server in line: commit local edits, pull what
   * others pushed (merging if both sides changed), then push.
   */
  sync(message = "Update notes"): Promise<SyncResult> {
    return this.run(async () => {
      // Shared by both attempts: a first attempt can merge files into the
      // folder before it fails, and the app must still hear about them.
      const result: SyncResult = { changed: [], conflicts: [], committed: null, pushed: false, head: "" };
      try {
        return await this.syncLocked(message, result);
      } catch (err) {
        if (!isMissingObject(err)) throw err;
        let repaired: { changed: string[]; conflicts: string[] };
        try {
          repaired = await this.repairLocked();
        } catch (repairErr) {
          if (repairErr instanceof OfflineError) repairErr.result = result;
          throw repairErr;
        }
        for (const p of repaired.changed) if (!result.changed.includes(p)) result.changed.push(p);
        for (const p of repaired.conflicts) if (!result.conflicts.includes(p)) result.conflicts.push(p);
        return await this.syncLocked(message, result);
      }
    });
  }

  private async syncLocked(message: string, result: SyncResult): Promise<SyncResult> {
    result.committed = (await this.commitLocked(message)) ?? result.committed;
    let recovered = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const pulled = await this.pullLocked();
        for (const p of pulled.changed) if (!result.changed.includes(p)) result.changed.push(p);
        for (const p of pulled.conflicts) if (!result.conflicts.includes(p)) result.conflicts.push(p);
      } catch (err) {
        throw this.translate(err, result);
      }
      const local = await git.resolveRef({ ...this.base, ref: "refs/heads/main" });
      const remote = await this.remoteHead();
      result.head = local;
      if (local === remote) break;
      try {
        const pushed = await git.push({ ...this.net, ref: "main", remoteRef: "main" });
        if (pushed.ok) {
          result.pushed = true;
          break;
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "PushRejectedError") continue; // someone pushed first: pull again
        if (code === "GitPushError" && !recovered) {
          // The server refused the change (a view-only shared note). Put
          // those files back to the server's version and try once more.
          recovered = true;
          const reverted = await this.revertForeignShared();
          for (const p of reverted) if (!result.changed.includes(p)) result.changed.push(p);
          if (reverted.length) continue;
        }
        throw this.translate(err, result);
      }
    }
    return result;
  }

  /** History of the space, newest first. */
  log(limit = 50, path?: string): Promise<CommitInfo[]> {
    return this.run(async () => {
      const commits = await git.log({ ...this.base, ref: "main", depth: path ? undefined : limit, filepath: path, force: true });
      return commits.slice(0, limit).map((c) => ({
        oid: c.oid,
        message: c.commit.message.trim(),
        authorName: c.commit.author.name,
        authorEmail: c.commit.author.email,
        time: c.commit.author.timestamp * 1000,
        parents: c.commit.parent,
      }));
    });
  }

  /** Versions of one file, newest first: only commits that actually changed its content. */
  fileHistory(path: string, limit = 30): Promise<CommitInfo[]> {
    return this.run(async () => {
      const commits = await git.log({ ...this.base, ref: "main", filepath: path, force: true });
      const out: CommitInfo[] = [];
      let newerBlob: string | null | undefined;
      let pending: CommitInfo | null = null;
      for (const c of commits) {
        const blob = await this.blobOidAt(c.oid, path);
        const info: CommitInfo = {
          oid: c.oid,
          message: c.commit.message.trim(),
          authorName: c.commit.author.name,
          authorEmail: c.commit.author.email,
          time: c.commit.author.timestamp * 1000,
          parents: c.commit.parent,
        };
        // Walking back in time: the oldest commit holding a given content is the one that wrote it.
        if (pending && blob !== newerBlob) {
          out.push(pending);
          if (out.length >= limit) return out;
        }
        if (blob !== null) pending = info;
        else pending = null;
        newerBlob = blob;
      }
      if (pending) out.push(pending);
      return out;
    });
  }

  /** Files that a commit changed compared with its (first) parent. */
  changedIn(commit: CommitInfo): Promise<{ path: string; kind: "added" | "changed" | "removed" }[]> {
    return this.run(async () => {
      if (commit.parents.length === 0) {
        const tree = await this.diffTrees([commit.oid]);
        return [...tree.keys()].map((path) => ({ path, kind: "added" as const }));
      }
      const diff = await this.diffTrees([commit.parents[0], commit.oid]);
      return [...diff.entries()].map(([path, [before, after]]) => ({
        path,
        kind: before === null ? ("added" as const) : after === null ? ("removed" as const) : ("changed" as const),
      }));
    });
  }

  /** Content of a file as it was in a given commit. */
  readAt(oid: string, path: string): Promise<string | null> {
    return this.run(() => this.blobText(oid, path));
  }

  // ---------------------------------------------------------- internals ----

  private translate(err: unknown, result?: SyncResult): Error {
    const e = err as { code?: string; data?: { statusCode?: number; response?: string }; message?: string };
    if (e?.code === "HttpError") {
      const status = e.data?.statusCode;
      if (status === 401 || status === 403 || status === 404) {
        return new AccessError((e.data?.response || e.message || "No access").trim(), status);
      }
    }
    if (e?.code === "GitPushError") return new AccessError(e.message ?? "The server refused the change");
    if (err instanceof AccessError) return err;
    const status = e?.code === "HttpError" ? e.data?.statusCode ?? 0 : 0;
    const networkCodes = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET"];
    const looksOffline =
      err instanceof TypeError || // fetch() failures in browsers
      status >= 500 ||
      networkCodes.includes(e?.code ?? "") ||
      /network|fetch|socket|ECONN/i.test(e?.message ?? "");
    if (looksOffline) {
      return new OfflineError(result ?? { changed: [], conflicts: [], committed: null, pushed: false, head: "" }, err);
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private async remoteHead(): Promise<string | null> {
    try {
      return await git.resolveRef({ ...this.base, ref: "refs/remotes/origin/main" });
    } catch {
      return null;
    }
  }

  private async blobText(commitOid: string, path: string): Promise<string | null> {
    try {
      const { blob } = await git.readBlob({ ...this.base, oid: commitOid, filepath: path });
      return decoder.decode(blob);
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  private async blobOidAt(commitOid: string, path: string): Promise<string | null> {
    try {
      const { oid } = await git.readBlob({ ...this.base, oid: commitOid, filepath: path });
      return oid;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  private async commitLocked(message: string): Promise<string | null> {
    if (this.dirty.size === 0) return null;
    const head = await git.resolveRef({ ...this.base, ref: "refs/heads/main" });
    let changed = 0;
    for (const path of [...this.dirty]) {
      const content = await this.readRaw(path);
      const before = await this.blobOidAt(head, path);
      const after = content === null ? null : (await git.hashBlob({ object: content })).oid;
      if (before === after) continue;
      changed++;
      if (content === null) await git.remove({ ...this.base, filepath: path });
      else await git.add({ ...this.base, filepath: path });
    }
    this.dirty.clear();
    await this.saveDirty();
    if (changed === 0) return null;
    return git.commit({ ...this.base, message, author: this.identity() });
  }

  private identity() {
    return { name: this.author.name || "Margin user", email: this.author.email || "user@margin.local" };
  }

  /**
   * Compares the trees of several commits. Returns only the paths that are not
   * identical everywhere, with each commit's blob id (null = absent).
   */
  private async diffTrees(oids: string[]): Promise<Map<string, (string | null)[]>> {
    const out = new Map<string, (string | null)[]>();
    await git.walk({
      ...this.base,
      trees: oids.map((oid) => git.TREE({ ref: oid })),
      map: async (filepath, entries) => {
        if (filepath === ".") return true;
        const list = entries ?? [];
        const ids = await Promise.all(list.map((e) => (e ? e.oid() : Promise.resolve(null))));
        if (oids.length > 1 && ids.every((id) => id === ids[0])) return null; // identical: skip subtree
        const types = await Promise.all(list.map((e) => (e ? e.type() : Promise.resolve(null))));
        if (types.some((t) => t === "tree")) return true;
        out.set(filepath, ids as (string | null)[]);
        return true;
      },
    });
    return out;
  }

  private async blobByOid(oid: string | null): Promise<string | null> {
    if (!oid) return null;
    const { blob } = await git.readBlob({ ...this.base, oid });
    return decoder.decode(blob);
  }

  private async apply(path: string, content: string | null) {
    await this.writeRaw(path, content);
    if (content === null) {
      try {
        await git.remove({ ...this.base, filepath: path });
      } catch {
        /* was not tracked */
      }
    } else {
      await git.add({ ...this.base, filepath: path });
    }
  }

  /** Every file in a working folder (not .git), as repo-relative path to text. */
  private async readFolder(dir: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const walk = async (rel: string) => {
      const names: string[] = await this.pfs.readdir(rel ? `${dir}/${rel}` : dir);
      for (const name of names) {
        if (!rel && name === ".git") continue;
        const child = rel ? `${rel}/${name}` : name;
        const stat = await this.pfs.stat(`${dir}/${child}`);
        if (stat.isDirectory()) await walk(child);
        else out.set(child, (await this.pfs.readFile(`${dir}/${child}`, { encoding: "utf8" })) as string);
      }
    };
    await walk("");
    return out;
  }

  /**
   * Where this copy and the server last agreed. Not the remote-tracking ref
   * alone: a fetch moves that ahead before the folder has taken the changes.
   */
  private async lastSharedCommit(): Promise<string | null> {
    try {
      const local = await git.resolveRef({ ...this.base, ref: "refs/heads/main" });
      const remote = await this.remoteHead();
      if (!remote) return null;
      const [shared] = (await git.findMergeBase({ ...this.base, oids: [local, remote] })) as string[];
      return shared ?? null;
    } catch {
      return null;
    }
  }

  /** The files of a commit, or null if any part of it can no longer be read. */
  private async filesAt(commitOid: string | null): Promise<Map<string, string> | null> {
    if (!commitOid) return null;
    try {
      const out = new Map<string, string>();
      for (const path of await git.listFiles({ ...this.base, ref: commitOid })) {
        const { blob } = await git.readBlob({ ...this.base, oid: commitOid, filepath: path });
        out.set(path, decoder.decode(blob));
      }
      return out;
    } catch {
      return null;
    }
  }

  /**
   * This copy refers to git objects it does not have, so it can no longer
   * commit, pull or push. That happens when its files are changed underneath
   * it, or the server's repository is swapped for another copy (a folder-sync
   * tool such as Syncthing on the server's data folder does both).
   *
   * Download a fresh copy from the server, then lay this device's files back
   * on top with the usual merge rules. The base for the merge is the last
   * commit this copy and the server had in common, when that can still be
   * read. Without it, a file only one side has is kept and a note that
   * differs keeps both versions and is flagged, so nothing is lost.
   * The old copy is kept aside until the new one holds everything.
   */
  private async repairLocked(): Promise<{ changed: string[]; conflicts: string[] }> {
    const mine = await this.readFolder(this.dir);
    const base = await this.filesAt(await this.lastSharedCommit());

    const fresh = `${this.dir}.fresh`;
    const aside = `${this.dir}.broken`;
    await this.rmrf(fresh);
    await this.mkdirp(fresh);
    try {
      await git.clone({ ...this.net, dir: fresh, ref: "main", singleBranch: true, noTags: true });
    } catch (err) {
      await this.rmrf(fresh).catch(() => undefined);
      throw this.translate(err);
    }
    await this.rmrf(aside);
    await this.pfs.rename(this.dir, aside);
    await this.pfs.rename(fresh, this.dir);
    await this.pfs.writeFile(`${this.dir}/.git/margin-cloned`, "1", { encoding: "utf8" });

    const theirs = await this.readFolder(this.dir);
    const changed: string[] = [];
    const conflicts: string[] = [];
    for (const path of [...new Set([...mine.keys(), ...theirs.keys()])].sort()) {
      const ours = mine.get(path) ?? null;
      const server = theirs.get(path) ?? null;
      if (ours === server) continue;
      let merged;
      if (base) merged = mergeFile(path, base.get(path) ?? null, ours, server);
      else if (ours === null) merged = { content: server }; // cannot tell a local delete from a new server file: keep it
      else merged = mergeFile(path, null, ours, server);
      if (merged.content !== server) await this.apply(path, merged.content);
      if (merged.content !== ours) changed.push(path);
      for (const extra of merged.extra ?? []) {
        await this.apply(extra.path, extra.content);
        changed.push(extra.path);
      }
      if (merged.conflict) conflicts.push(path);
    }
    this.dirty.clear();
    await this.saveDirty();
    const status = await git.statusMatrix({ ...this.base });
    if (status.some(([, head, , stage]) => head !== stage)) {
      await git.commit({ ...this.base, message: "Recover changes from this device", author: this.identity() });
    }
    await this.rmrf(aside);
    return { changed, conflicts };
  }

  private async pullLocked(): Promise<{ changed: string[]; conflicts: string[] }> {
    await git.fetch({ ...this.net, remote: "origin", ref: "main", remoteRef: "main", singleBranch: true, tags: false });
    const local = await git.resolveRef({ ...this.base, ref: "refs/heads/main" });
    const remote = await this.remoteHead();
    if (!remote || remote === local) return { changed: [], conflicts: [] };
    const [base] = (await git.findMergeBase({ ...this.base, oids: [local, remote] })) as string[];
    if (base === remote) return { changed: [], conflicts: [] }; // we are simply ahead

    const changed: string[] = [];
    const conflicts: string[] = [];

    if (base === local) {
      // Fast-forward: take the server's files as they are.
      const diff = await this.diffTrees([local, remote]);
      for (const [path, [, theirs]] of diff) {
        await this.apply(path, await this.blobByOid(theirs));
        changed.push(path);
      }
      await git.writeRef({ ...this.base, ref: "refs/heads/main", value: remote, force: true });
      return { changed, conflicts };
    }

    // Both sides have new commits: merge file by file.
    const diff = await this.diffTrees([base, local, remote]);
    for (const [path, [b, ours, theirs]] of diff) {
      if (ours === theirs || theirs === b) continue;
      if (ours === b) {
        await this.apply(path, await this.blobByOid(theirs));
        changed.push(path);
        continue;
      }
      const oursText = await this.blobByOid(ours);
      const merged = mergeFile(path, await this.blobByOid(b), oursText, await this.blobByOid(theirs));
      if (merged.content !== oursText) {
        await this.apply(path, merged.content);
        changed.push(path);
      }
      for (const extra of merged.extra ?? []) {
        await this.apply(extra.path, extra.content);
        changed.push(extra.path);
      }
      if (merged.conflict) conflicts.push(path);
    }
    await git.commit({
      ...this.base,
      message: conflicts.length ? "Merge changes (kept both versions of clashing notes)" : "Merge changes",
      author: this.identity(),
      parent: [local, remote],
    });
    return { changed, conflicts };
  }

  /** Undo local changes to other members' shared notes that the server will not accept. */
  private async revertForeignShared(): Promise<string[]> {
    const local = await git.resolveRef({ ...this.base, ref: "refs/heads/main" });
    const remote = await this.remoteHead();
    if (!remote) return [];
    const diff = await this.diffTrees([remote, local]);
    const reverted: string[] = [];
    for (const [path, [theirs]] of diff) {
      if (!path.startsWith("shared/") || path.split("/")[1] === this.author.id) continue;
      await this.apply(path, await this.blobByOid(theirs));
      reverted.push(path);
    }
    if (reverted.length) {
      await git.commit({ ...this.base, message: "Discard edits to view-only shared notes", author: this.identity() });
    }
    return reverted;
  }
}
