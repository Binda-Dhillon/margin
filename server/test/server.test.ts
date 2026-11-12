import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "margin-server-"));
let server: http.Server;

interface Account {
  cookie: string;
  id: string;
  token: string;
  email: string;
}

async function call(acct: { cookie: string } | null, method: string, url: string, body?: unknown) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      ...(acct ? { Cookie: acct.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, headers: res.headers };
}

async function signUp(name: string, email: string, password = "correct-horse-7!"): Promise<Account> {
  const res = await call(null, "POST", "/api/auth/sign-up/email", { name, email, password });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const acct = { cookie, id: "", token: "", email };
  const me = await call(acct, "GET", "/api/me");
  acct.id = me.json.user.id;
  acct.token = (await call(acct, "POST", "/api/tokens", { name: "test" })).json.token;
  return acct;
}

// The server runs inside this test process, so git must not block the event loop.
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", HOME: tmp },
  });
  return stdout;
}

async function tryGit(cwd: string, ...args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    return { ok: true, out: await git(cwd, ...args) };
  } catch (err: any) {
    return { ok: false, out: String(err.stderr ?? err.message) };
  }
}

async function clone(acct: Account, space: string, name: string): Promise<string> {
  const dir = path.join(tmp, name);
  await git(tmp, "clone", "-q", `http://x:${acct.token}@localhost:${PORT}/git/${space}.git`, dir);
  await git(dir, "config", "user.name", name);
  await git(dir, "config", "user.email", acct.email);
  return dir;
}

function write(dir: string, file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

async function commitPush(dir: string, message: string) {
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", message);
  return tryGit(dir, "push", "-q", "origin", "main");
}

const shared = (owner: string, access: string, body: string) =>
  `---\nid: n1\ntitle: Reading list\nsharedOwner: ${owner}\nsharedAccess: ${access}\n---\n\n${body}\n`;

beforeAll(async () => {
  process.env.DATA_DIR = path.join(tmp, "data");
  process.env.PORT = String(PORT);
  process.env.PUBLIC_URL = BASE;
  process.env.MARGIN_NO_LISTEN = "1";
  const mod = await import("../src/index.js");
  server = await mod.startServer(PORT);
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("accounts", () => {
  it("rejects weak passwords and accepts strong ones", async () => {
    const weak = await call(null, "POST", "/api/auth/sign-up/email", {
      name: "Weak",
      email: "weak@example.com",
      password: "password",
    });
    expect(weak.status).toBe(400);
    expect(weak.json.message).toMatch(/number/);
    const ok = await signUp("Strong", "strong@example.com");
    expect(ok.id).toBeTruthy();
  });

  it("logs in with email and password", async () => {
    await signUp("Login", "login@example.com");
    const res = await call(null, "POST", "/api/auth/sign-in/email", {
      email: "login@example.com",
      password: "correct-horse-7!",
    });
    expect(res.status).toBe(200);
    const bad = await call(null, "POST", "/api/auth/sign-in/email", { email: "login@example.com", password: "nope-nope-1!" });
    expect(bad.status).toBe(401);
  });

  it("requires a session for the API", async () => {
    expect((await call(null, "GET", "/api/me")).status).toBe(401);
  });
});

describe("groups and git access", () => {
  let amara: Account, sanjay: Account, kiran: Account;
  let gid: string;

  beforeAll(async () => {
    amara = await signUp("Amara Okafor", "amara@example.com");
    sanjay = await signUp("Sanjay Mehta", "sanjay@example.com");
    kiran = await signUp("Kiran Patel", "kiran@example.com");
    const created = await call(amara, "POST", "/api/groups", { name: "Group poster" });
    gid = created.json.group.id;
  });

  it("adds members by email and notifies them", async () => {
    const add = await call(amara, "POST", `/api/groups/${gid}/members`, { email: "sanjay@example.com" });
    expect(add.status).toBe(200);
    const me = await call(sanjay, "GET", "/api/me");
    expect(me.json.groups.map((g: any) => g.name)).toEqual(["Group poster"]);
    expect(me.json.groups[0].members.map((m: any) => m.name).sort()).toEqual(["Amara Okafor", "Sanjay Mehta"]);
    expect(me.json.notifications[0].kind).toBe("added-to-group");
    expect(me.json.notifications[0].payload.byName).toBe("Amara Okafor");
  });

  it("lets a user join with the invite link code", async () => {
    const me = await call(amara, "GET", "/api/me");
    const code = me.json.groups[0].inviteCode;
    const join = await call(kiran, "POST", "/api/groups/join", { code });
    expect(join.json.groupId).toBe(gid);
    await call(amara, "DELETE", `/api/groups/${gid}/members/${kiran.id}`);
    const after = await call(kiran, "GET", "/api/me");
    expect(after.json.groups).toEqual([]);
  });

  it("keeps personal spaces private", async () => {
    const mine = await clone(amara, `u/${amara.id}`, "amara-personal");
    expect(fs.existsSync(path.join(mine, ".margin", "space.json"))).toBe(true);
    const theirs = await tryGit(tmp, "clone", "-q", `http://x:${sanjay.token}@localhost:${PORT}/git/u/${amara.id}.git`, "x1");
    expect(theirs.ok).toBe(false);
    expect(theirs.out).toMatch(/403/);
  });

  it("refuses non-members and anonymous clients", async () => {
    const outsider = await tryGit(tmp, "clone", "-q", `http://x:${kiran.token}@localhost:${PORT}/git/g/${gid}.git`, "x2");
    expect(outsider.ok).toBe(false);
    const anon = await tryGit(tmp, "clone", "-q", `http://localhost:${PORT}/git/g/${gid}.git`, "x3");
    expect(anon.ok).toBe(false);
  });

  it("syncs group notes between members and enforces shared-note access", async () => {
    const a = await clone(amara, `g/${gid}`, "amara-group");
    const s = await clone(sanjay, `g/${gid}`, "sanjay-group");

    write(a, "notes/n100.md", "---\nid: n100\ntitle: Methods\n---\n\nDraft\n");
    expect((await commitPush(a, "Add methods")).ok).toBe(true);
    await git(s, "pull", "-q", "origin", "main");
    expect(fs.readFileSync(path.join(s, "notes/n100.md"), "utf8")).toMatch(/Draft/);
    expect(await git(s, "log", "-1", "--format=%an")).toMatch(/amara-group/);

    // Sanjay cannot publish into Amara's shared folder.
    write(s, `shared/${amara.id}/fake.md`, shared(amara.id, "edit", "forged"));
    const forged = await commitPush(s, "forge");
    expect(forged.ok).toBe(false);
    expect(forged.out).toMatch(/belongs to another member/);
    await git(s, "reset", "-q", "--hard", "origin/main");

    // Amara shares a personal note as view-only: Sanjay can read, not write.
    write(a, `shared/${amara.id}/n1.md`, shared(amara.id, "view", "Coolican ch. 3"));
    expect((await commitPush(a, "Share reading list (view)")).ok).toBe(true);
    await git(s, "pull", "-q", "origin", "main");
    write(s, `shared/${amara.id}/n1.md`, shared(amara.id, "view", "Coolican ch. 3\nField 2018"));
    const viewOnly = await commitPush(s, "edit view-only");
    expect(viewOnly.ok).toBe(false);
    expect(viewOnly.out).toMatch(/view-only/);
    await git(s, "reset", "-q", "--hard", "origin/main");

    // Amara raises it to edit: Sanjay's change is accepted...
    write(a, `shared/${amara.id}/n1.md`, shared(amara.id, "edit", "Coolican ch. 3"));
    expect((await commitPush(a, "Share reading list (edit)")).ok).toBe(true);
    await git(s, "pull", "-q", "origin", "main");
    write(s, `shared/${amara.id}/n1.md`, shared(amara.id, "edit", "Coolican ch. 3\nField 2018"));
    expect((await commitPush(s, "add a reading")).ok).toBe(true);

    // ...but he still cannot change the access level or unshare it.
    write(s, `shared/${amara.id}/n1.md`, shared(amara.id, "view", "locked by sanjay"));
    const relevel = await commitPush(s, "relevel");
    expect(relevel.ok).toBe(false);
    expect(relevel.out).toMatch(/only the owner/);
    await git(s, "reset", "-q", "--hard", "origin/main");
    fs.rmSync(path.join(s, `shared/${amara.id}/n1.md`));
    const unshare = await commitPush(s, "unshare");
    expect(unshare.ok).toBe(false);
    await git(s, "reset", "-q", "--hard", "origin/main");
  });

  it("only accepts fast-forward pushes to main", async () => {
    const a = path.join(tmp, "amara-group");
    await git(a, "pull", "-q", "origin", "main");
    await git(a, "checkout", "-q", "-b", "side");
    write(a, "notes/side.md", "x");
    await git(a, "add", "-A");
    await git(a, "commit", "-q", "-m", "side");
    const side = await tryGit(a, "push", "-q", "origin", "side");
    expect(side.ok).toBe(false);
    expect(side.out).toMatch(/only the main branch/);
    await git(a, "checkout", "-q", "main");
    await git(a, "commit", "-q", "--amend", "-m", "rewritten history");
    const force = await tryGit(a, "push", "-q", "--force", "origin", "main");
    expect(force.ok).toBe(false);
  });

  it("sends a live event to members when a space changes", async () => {
    const controller = new AbortController();
    const res = await fetch(`${BASE}/api/events`, { headers: { Cookie: sanjay.cookie }, signal: controller.signal });
    const reader = res.body!.getReader();
    const seen: any[] = [];
    const pump = (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (const line of buffer.split("\n")) {
          if (line.startsWith("data:")) {
            try {
              seen.push(JSON.parse(line.slice(5)));
            } catch {
              /* partial line */
            }
          }
        }
        buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
      }
    })();
    await new Promise((r) => setTimeout(r, 200));
    const a = path.join(tmp, "amara-group");
    await git(a, "fetch", "-q", "origin");
    await git(a, "reset", "-q", "--hard", "origin/main");
    write(a, "notes/n200.md", "---\nid: n200\ntitle: Live\n---\n\nhello\n");
    expect((await commitPush(a, "live")).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    controller.abort();
    await pump;
    const repoEvent = seen.find((e) => e.type === "repo");
    expect(repoEvent?.space).toBe(`g:${gid}`);
    expect(repoEvent?.by.name).toBe("Amara Okafor");
  });
});
