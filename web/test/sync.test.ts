import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import gitHttp from "isomorphic-git/http/node";
import { AccessError, OfflineError, SpaceRepo, type GitEnv } from "../src/core/repo";
import { blankMeta, parseNoteFile, privateStub, serializeNoteFile } from "../src/core/notefile";
import { parseBoard } from "../src/core/merge";
import { PATHS, type Author, type Card, type NoteMeta } from "../src/core/types";

const PORT = 19000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "margin-sync-"));
let server: http.Server;

interface Member {
  author: Author;
  cookie: string;
  env: GitEnv;
}

async function api(member: { cookie: string } | null, method: string, url: string, body?: unknown) {
  const res = await fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json", Origin: BASE, ...(member ? { Cookie: member.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any, headers: res.headers };
}

async function join(name: string, device = "laptop"): Promise<Member> {
  const email = `${name.toLowerCase()}@example.com`;
  let res = await api(null, "POST", "/api/auth/sign-up/email", { name, email, password: "correct-horse-7!" });
  if (res.status !== 200) {
    res = await api(null, "POST", "/api/auth/sign-in/email", { email, password: "correct-horse-7!" });
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const me = await api({ cookie }, "GET", "/api/me");
  const root = path.join(tmp, `${name}-${device}`);
  fs.mkdirSync(root, { recursive: true });
  return {
    author: { id: me.json.user.id, name, email },
    cookie,
    env: { fs, http: gitHttp, baseUrl: BASE, root, headers: { Cookie: cookie, "X-Margin-Client": "web" } },
  };
}

function note(id: string, title: string, body: string, by: Author, extra: Partial<NoteMeta> = {}): string {
  const meta = { ...blankMeta(id, "text"), title, updatedById: by.id, updatedByName: by.name, ...extra };
  return serializeNoteFile(meta, body);
}

const tick = () => new Promise((r) => setTimeout(r, 5));

beforeAll(async () => {
  process.env.DATA_DIR = path.join(tmp, "data");
  process.env.PORT = String(PORT);
  process.env.PUBLIC_URL = BASE;
  process.env.MARGIN_NO_LISTEN = "1";
  const mod = await import("../../server/src/index.js");
  server = await mod.startServer(PORT);
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("a member's folder", () => {
  let amara: Member, sanjay: Member;
  let group: string;
  let a: SpaceRepo, s: SpaceRepo;

  beforeAll(async () => {
    amara = await join("Amara");
    sanjay = await join("Sanjay");
    group = (await api(amara, "POST", "/api/groups", { name: "Group poster" })).json.group.id;
    await api(amara, "POST", `/api/groups/${group}/members`, { email: sanjay.author.email });
    a = new SpaceRepo(amara.env, `g:${group}`, amara.author);
    s = new SpaceRepo(sanjay.env, `g:${group}`, sanjay.author);
  });

  it("is cloned on first connection and reopened afterwards", async () => {
    expect(await a.open()).toBe("cloned");
    expect(await s.open()).toBe("cloned");
    expect(await a.read(".margin/space.json")).toContain('"kind": "group"');
    const again = new SpaceRepo(amara.env, `g:${group}`, amara.author);
    expect(await again.open()).toBe("existing");
  });

  it("pushes edits and updates the other member on their next sync", async () => {
    await a.write(PATHS.note("n1"), note("n1", "Methods", "Participants\n\nDesign\n", amara.author));
    const pushed = await a.sync("Add Methods");
    expect(pushed.committed).toBeTruthy();
    expect(pushed.pushed).toBe(true);

    const pulled = await s.sync();
    expect(pulled.changed).toEqual([PATHS.note("n1")]);
    expect(pulled.pushed).toBe(false);
    const parsed = parseNoteFile(PATHS.note("n1"), (await s.read(PATHS.note("n1")))!);
    expect(parsed.meta.title).toBe("Methods");
    expect(parsed.meta.updatedByName).toBe("Amara");
  });

  it("does not create empty commits", async () => {
    const before = await a.head();
    await a.write(PATHS.note("n1"), (await a.read(PATHS.note("n1")))!);
    const result = await a.sync();
    expect(result.committed).toBeNull();
    expect(await a.head()).toBe(before);
  });

  it("merges edits to different notes made while apart", async () => {
    await a.write(PATHS.note("n2"), note("n2", "Ethics", "Consent form\n", amara.author));
    await s.write(PATHS.note("n3"), note("n3", "Results", "Mock graphs\n", sanjay.author));
    await a.sync("Add Ethics");
    const merged = await s.sync("Add Results");
    expect(merged.changed).toContain(PATHS.note("n2"));
    expect(merged.conflicts).toEqual([]);
    expect(merged.pushed).toBe(true);
    await a.sync();
    expect(await a.read(PATHS.note("n3"))).toContain("Mock graphs");
    const log = await a.log(5);
    expect(log[0].message).toBe("Merge changes");
    expect(log[0].parents.length).toBe(2);
  });

  it("merges edits to different parts of the same note", async () => {
    const start = note("n4", "Plan", "Intro line\n\nMiddle line\n\nEnd line\n", amara.author);
    await a.write(PATHS.note("n4"), start);
    await a.sync();
    await s.sync();

    await a.write(PATHS.note("n4"), start.replace("Intro line", "Intro line (Amara)"));
    await s.write(PATHS.note("n4"), start.replace("End line", "End line (Sanjay)"));
    await a.sync();
    const merged = await s.sync();
    expect(merged.conflicts).toEqual([]);
    const text = (await s.read(PATHS.note("n4")))!;
    expect(text).toContain("Intro line (Amara)");
    expect(text).toContain("End line (Sanjay)");
    await a.sync();
    expect(await a.read(PATHS.note("n4"))).toBe(text);
  });

  it("keeps both versions when the same lines were edited, and flags the note", async () => {
    const start = note("n5", "Sampling", "We will use opportunity sampling.\n", amara.author);
    await a.write(PATHS.note("n5"), start);
    await a.sync();
    await s.sync();

    await a.write(
      PATHS.note("n5"),
      note("n5", "Sampling", "We will use stratified sampling.\n", amara.author, { updated: "2026-11-04T12:00:00.000Z" }),
    );
    await s.write(
      PATHS.note("n5"),
      note("n5", "Sampling", "We will use snowball sampling.\n", sanjay.author, { updated: "2026-11-04T12:05:00.000Z" }),
    );
    await a.sync();
    const merged = await s.sync();
    expect(merged.conflicts).toEqual([PATHS.note("n5")]);
    expect(merged.pushed).toBe(true);
    // Sanjay keeps his text in place; Amara's version sits beside it.
    expect(await s.read(PATHS.note("n5"))).toContain("snowball");
    const other = parseNoteFile(PATHS.conflictOf(PATHS.note("n5")), (await s.read(PATHS.conflictOf(PATHS.note("n5"))))!);
    expect(other.body).toContain("stratified");
    expect(other.meta.updatedByName).toBe("Amara");
    // Amara sees the same flag after syncing.
    const back = await a.sync();
    expect(back.changed).toContain(PATHS.conflictOf(PATHS.note("n5")));
    expect(await a.read(PATHS.note("n5"))).toContain("snowball");
  });

  it("merges drawings element by element", async () => {
    const meta = { ...blankMeta("d1", "drawing"), title: "Study design" };
    const scene = (elements: unknown[]) =>
      serializeNoteFile(meta, JSON.stringify({ type: "excalidraw", elements, appState: {}, files: {} }));
    const box = (id: string, version: number, x = 0) => ({ id, type: "rectangle", version, versionNonce: 1, x, isDeleted: false });
    await a.write(PATHS.drawing("d1"), scene([box("one", 1)]));
    await a.sync();
    await s.sync();
    await a.write(PATHS.drawing("d1"), scene([box("one", 2, 50), box("two", 1)]));
    await s.write(PATHS.drawing("d1"), scene([box("one", 1), box("three", 1)]));
    await a.sync();
    const merged = await s.sync();
    expect(merged.conflicts).toEqual([]);
    const elements = JSON.parse((await s.read(PATHS.drawing("d1")))!).elements;
    expect(elements.map((e: any) => e.id).sort()).toEqual(["one", "three", "two"]);
    expect(elements.find((e: any) => e.id === "one").x).toBe(50);
  });

  it("merges the board card by card", async () => {
    const card = (id: string, column: string, by: Author, updated: string): Card => ({
      id,
      title: id,
      description: "",
      column,
      order: 1,
      label: "",
      assignee: null,
      due: null,
      notes: [],
      checklist: [],
      comments: [],
      movedById: by.id,
      movedByName: by.name,
      movedAt: updated,
      created: updated,
      updated,
      updatedById: by.id,
    });
    const board = (cards: Card[]) =>
      JSON.stringify({ version: 1, columns: [{ id: "todo", name: "To do" }, { id: "review", name: "Review" }], cards: Object.fromEntries(cards.map((c) => [c.id, c])) });
    await a.write(PATHS.board, board([card("c1", "todo", amara.author, "2026-11-04T10:00:00Z"), card("c2", "todo", amara.author, "2026-11-04T10:00:00Z")]));
    await a.sync();
    await s.sync();
    // Sanjay moves c1 to Review; Amara adds c3 and renames nothing else.
    await s.write(PATHS.board, board([card("c1", "review", sanjay.author, "2026-11-04T12:41:00Z"), card("c2", "todo", amara.author, "2026-11-04T10:00:00Z")]));
    await a.write(PATHS.board, board([card("c1", "todo", amara.author, "2026-11-04T10:00:00Z"), card("c2", "todo", amara.author, "2026-11-04T10:00:00Z"), card("c3", "todo", amara.author, "2026-11-04T12:50:00Z")]));
    await s.sync();
    await a.sync();
    const merged = parseBoard(await a.read(PATHS.board));
    expect(Object.keys(merged.cards).sort()).toEqual(["c1", "c2", "c3"]);
    expect(merged.cards.c1.column).toBe("review");
    expect(merged.cards.c1.movedByName).toBe("Sanjay");
  });

  it("records who changed what, and can read old versions back", async () => {
    await a.write(PATHS.note("n1"), note("n1", "Methods", "Participants\n\nDesign\n\nProcedure\n", amara.author));
    await a.sync("Edit Methods");
    const log = await a.log(20);
    const edit = log.find((c) => c.message === "Edit Methods")!;
    expect(edit.authorName).toBe("Amara");
    expect(await a.changedIn(edit)).toEqual([{ path: PATHS.note("n1"), kind: "changed" }]);
    const history = await a.fileHistory(PATHS.note("n1"));
    expect(history.length).toBe(2);
    const old = await a.readAt(history[1].oid, PATHS.note("n1"));
    expect(old).not.toContain("Procedure");
    // Restore: write the old content back as a new version.
    await a.write(PATHS.note("n1"), old!);
    await a.sync("Restore Methods");
    await s.sync();
    expect(await s.read(PATHS.note("n1"))).not.toContain("Procedure");
  });

  it("keeps working offline and catches up on reconnection", async () => {
    const offline = new SpaceRepo({ ...sanjay.env, baseUrl: "http://localhost:9" }, `g:${group}`, sanjay.author);
    await offline.open();
    await offline.write(PATHS.note("n6"), note("n6", "Written on the train", "No signal\n", sanjay.author));
    await expect(offline.sync("Offline note")).rejects.toBeInstanceOf(OfflineError);
    // The edit is committed locally and goes out with the next successful sync.
    const online = new SpaceRepo(sanjay.env, `g:${group}`, sanjay.author);
    await online.open();
    const result = await online.sync();
    expect(result.pushed).toBe(true);
    await a.sync();
    expect(await a.read(PATHS.note("n6"))).toContain("No signal");
  });

  it("keeps edits that were written but not yet committed when the app restarts", async () => {
    await s.write(PATHS.note("n7"), note("n7", "Half saved", "typed just before closing the tab\n", sanjay.author));
    const reopened = new SpaceRepo(sanjay.env, `g:${group}`, sanjay.author);
    await reopened.open();
    expect(reopened.hasLocalChanges()).toBe(true);
    const result = await reopened.sync("Recovered edit");
    expect(result.pushed).toBe(true);
  });

  describe("personal notes linked into the group", () => {
    const sharedPath = () => PATHS.shared(amara.author.id, "p1", "text");
    const publish = (access: "private" | "view" | "edit", body: string) => {
      const meta: NoteMeta = {
        ...blankMeta("p1", "text"),
        title: "Reading list",
        links: ["n1"],
        sharedOwner: amara.author.id,
        sharedOwnerName: "Amara",
        sharedAccess: access,
        updatedById: amara.author.id,
        updatedByName: "Amara",
      };
      if (access === "private") {
        const stub = privateStub(meta);
        return serializeNoteFile(stub.meta, stub.body);
      }
      return serializeNoteFile(meta, body);
    };

    it("private: the group sees only that a note exists", async () => {
      await a.write(sharedPath(), publish("private", "Coolican ch. 3\n"));
      await a.sync("Link Reading list (private)");
      await s.sync();
      const seen = parseNoteFile(sharedPath(), (await s.read(sharedPath()))!);
      expect(seen.meta.title).toBe("Private note");
      expect(seen.meta.sharedAccess).toBe("private");
      expect(seen.meta.links).toEqual(["n1"]);
      expect(seen.body).toBe("");
    });

    it("view: members can read it; an edit is refused and rolled back", async () => {
      await a.write(sharedPath(), publish("view", "Coolican ch. 3\n"));
      await a.sync("Link Reading list (view)");
      await s.sync();
      expect(await s.read(sharedPath())).toContain("Coolican");
      await s.write(sharedPath(), publish("view", "Coolican ch. 3\nField 2018\n"));
      await s.write(PATHS.note("n8"), note("n8", "Unrelated", "kept\n", sanjay.author));
      const result = await s.sync("Edit a view-only note");
      // The refused file is restored; the rest of his work still goes through.
      expect(result.changed).toContain(sharedPath());
      expect(result.pushed).toBe(true);
      expect(await s.read(sharedPath())).not.toContain("Field 2018");
      await a.sync();
      expect(await a.read(PATHS.note("n8"))).toContain("kept");
      expect(await a.read(sharedPath())).not.toContain("Field 2018");
    });

    it("edit: a member's change reaches the owner", async () => {
      await a.write(sharedPath(), publish("edit", "Coolican ch. 3\n"));
      await a.sync("Link Reading list (edit)");
      await s.sync();
      await s.write(sharedPath(), publish("edit", "Coolican ch. 3\nField 2018\n"));
      const result = await s.sync("Add a reading");
      expect(result.pushed).toBe(true);
      const back = await a.sync();
      expect(back.changed).toContain(sharedPath());
      expect(await a.read(sharedPath())).toContain("Field 2018");
    });
  });

  it("refuses people who are not in the group", async () => {
    const kiran = await join("Kiran");
    const repo = new SpaceRepo(kiran.env, `g:${group}`, kiran.author);
    await expect(repo.open()).rejects.toBeInstanceOf(AccessError);
    const personal = new SpaceRepo(kiran.env, `u:${amara.author.id}`, kiran.author);
    await expect(personal.open()).rejects.toBeInstanceOf(AccessError);
  });

  it("syncs a personal space between two of the owner's devices", async () => {
    const tablet = await join("Amara", "tablet");
    const laptopRepo = new SpaceRepo(amara.env, `u:${amara.author.id}`, amara.author);
    const tabletRepo = new SpaceRepo(tablet.env, `u:${amara.author.id}`, amara.author);
    await laptopRepo.open();
    await tabletRepo.open();
    await laptopRepo.write(PATHS.note("p9"), note("p9", "Lecture 6", "Sampling\n", amara.author));
    await laptopRepo.sync();
    await tick();
    const got = await tabletRepo.sync();
    expect(got.changed).toEqual([PATHS.note("p9")]);
  });
});
