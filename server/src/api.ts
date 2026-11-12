import crypto from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { nanoid, customAlphabet } from "nanoid";
import { auth, userFromHeaders, type SessionUser } from "./auth.js";
import { config } from "./config.js";
import { db, getUser, getUserByEmail, groupsForUser, isMember, memberIds, type GroupRow } from "./db.js";
import { emitTo, subscribe, type ServerEvent } from "./events.js";
import { ensureRepo, hashToken, removeRepo } from "./git.js";

const groupId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const inviteCode = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 20);

type Env = { Variables: { user: SessionUser } };

export const api = new Hono<Env>();

api.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

api.get("/config", (c) =>
  c.json({
    providers: { google: !!config.google, microsoft: !!config.microsoft },
    allowSignup: config.allowSignup,
    publicUrl: config.publicUrl,
  }),
);

api.get("/health", (c) => c.json({ ok: true }));

// Everything below needs a signed-in user.
api.use("*", async (c, next) => {
  const user = await userFromHeaders(c.req.raw.headers);
  if (!user) return c.json({ error: "Sign in first" }, 401);
  c.set("user", user);
  await next();
});

function notify(userId: string, kind: string, payload: Record<string, unknown>) {
  const n = { id: nanoid(), kind, payload, createdAt: Date.now(), readAt: null as number | null };
  db.prepare("INSERT INTO notifications (id, user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)").run(
    n.id,
    userId,
    kind,
    JSON.stringify(payload),
    n.createdAt,
  );
  emitTo([userId], { type: "notification", notification: n });
}

function unreadNotifications(userId: string) {
  const rows = db
    .prepare(
      "SELECT id, kind, payload, created_at FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 20",
    )
    .all(userId) as { id: string; kind: string; payload: string; created_at: number }[];
  return rows.map((r) => ({ id: r.id, kind: r.kind, payload: JSON.parse(r.payload), createdAt: r.created_at }));
}

function groupOr404(id: string): GroupRow | undefined {
  return db.prepare("SELECT * FROM groups WHERE id = ?").get(id) as GroupRow | undefined;
}

api.get("/me", (c) => {
  const user = c.get("user");
  ensureRepo({ kind: "u", id: user.id }, { name: "My notes", createdBy: user });
  for (const g of groupsForUser(user.id)) {
    ensureRepo({ kind: "g", id: g.id }, { name: g.name, createdBy: user });
  }
  return c.json({ user, groups: groupsForUser(user.id), notifications: unreadNotifications(user.id) });
});

api.post("/groups", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return c.json({ error: "Give the group a name" }, 400);
  const id = groupId();
  db.transaction(() => {
    db.prepare("INSERT INTO groups (id, name, created_by, created_at, invite_code) VALUES (?, ?, ?, ?, ?)").run(
      id,
      name,
      user.id,
      Date.now(),
      inviteCode(),
    );
    db.prepare("INSERT INTO group_members (group_id, user_id, role, added_by, created_at) VALUES (?, ?, 'owner', ?, ?)").run(
      id,
      user.id,
      user.id,
      Date.now(),
    );
  })();
  ensureRepo({ kind: "g", id }, { name, createdBy: user });
  emitTo([user.id], { type: "groups" });
  return c.json({ group: groupsForUser(user.id).find((g) => g.id === id) });
});

api.patch("/groups/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isMember(id, user.id)) return c.json({ error: "Group not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.name === "string" && body.name.trim()) {
    db.prepare("UPDATE groups SET name = ? WHERE id = ?").run(body.name.trim().slice(0, 80), id);
  }
  if ("dueLabel" in body || "dueDate" in body) {
    db.prepare("UPDATE groups SET due_label = ?, due_date = ? WHERE id = ?").run(
      body.dueLabel ? String(body.dueLabel).slice(0, 60) : null,
      body.dueDate ? String(body.dueDate).slice(0, 10) : null,
      id,
    );
  }
  emitTo(memberIds(id), { type: "groups" });
  return c.json({ ok: true });
});

api.delete("/groups/:id", (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const group = groupOr404(id);
  if (!group || !isMember(id, user.id)) return c.json({ error: "Group not found" }, 404);
  const role = db.prepare("SELECT role FROM group_members WHERE group_id = ? AND user_id = ?").get(id, user.id) as {
    role: string;
  };
  if (role.role !== "owner") return c.json({ error: "Only the group owner can delete the group" }, 403);
  const audience = memberIds(id);
  db.prepare("DELETE FROM groups WHERE id = ?").run(id);
  removeRepo({ kind: "g", id });
  emitTo(audience, { type: "groups" });
  return c.json({ ok: true });
});

function addMember(group: GroupRow, userId: string, addedBy: SessionUser | null) {
  db.prepare(
    "INSERT OR IGNORE INTO group_members (group_id, user_id, role, added_by, created_at) VALUES (?, ?, 'member', ?, ?)",
  ).run(group.id, userId, addedBy?.id ?? null, Date.now());
  if (addedBy && addedBy.id !== userId) {
    notify(userId, "added-to-group", { groupId: group.id, groupName: group.name, byName: addedBy.name });
  }
  emitTo(memberIds(group.id), { type: "groups" });
}

api.post("/groups/:id/members", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const group = groupOr404(id);
  if (!group || !isMember(id, user.id)) return c.json({ error: "Group not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  const target = email ? getUserByEmail(email) : undefined;
  if (!target) {
    return c.json({ error: "No Margin account uses that email yet. Send them the invite link instead." }, 404);
  }
  if (isMember(id, target.id)) return c.json({ error: `${target.name} is already in this group` }, 409);
  addMember(group, target.id, user);
  return c.json({ ok: true });
});

api.post("/groups/join", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim();
  const group = db.prepare("SELECT * FROM groups WHERE invite_code = ?").get(code) as GroupRow | undefined;
  if (!group) return c.json({ error: "That invite link is no longer valid" }, 404);
  addMember(group, user.id, null);
  return c.json({ groupId: group.id });
});

api.post("/groups/:id/invite-code", (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isMember(id, user.id)) return c.json({ error: "Group not found" }, 404);
  const code = inviteCode();
  db.prepare("UPDATE groups SET invite_code = ? WHERE id = ?").run(code, id);
  emitTo(memberIds(id), { type: "groups" });
  return c.json({ inviteCode: code });
});

api.delete("/groups/:id/members/:userId", (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const targetId = c.req.param("userId");
  const group = groupOr404(id);
  if (!group || !isMember(id, user.id)) return c.json({ error: "Group not found" }, 404);
  const roles = db.prepare("SELECT user_id, role FROM group_members WHERE group_id = ? ORDER BY created_at").all(id) as {
    user_id: string;
    role: string;
  }[];
  const me = roles.find((r) => r.user_id === user.id)!;
  const target = roles.find((r) => r.user_id === targetId);
  if (!target) return c.json({ error: "They are not in this group" }, 404);
  if (targetId !== user.id && me.role !== "owner") {
    return c.json({ error: "Only the group owner can remove other members" }, 403);
  }
  const audience = memberIds(id);
  db.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").run(id, targetId);
  const remaining = roles.filter((r) => r.user_id !== targetId);
  if (remaining.length === 0) {
    db.prepare("DELETE FROM groups WHERE id = ?").run(id);
    removeRepo({ kind: "g", id });
  } else if (target.role === "owner") {
    db.prepare("UPDATE group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?").run(id, remaining[0].user_id);
  }
  if (targetId !== user.id) {
    notify(targetId, "removed-from-group", { groupId: id, groupName: group.name, byName: user.name });
  }
  emitTo(audience, { type: "groups" });
  return c.json({ ok: true });
});

// ------------------------------------------------------------ live events --

api.get("/events", (c) => {
  const user = c.get("user");
  return streamSSE(c, async (stream) => {
    const queue: ServerEvent[] = [];
    let wake: (() => void) | null = null;
    let open = true;
    const unsubscribe = subscribe(user.id, (event) => {
      queue.push(event);
      wake?.();
    });
    stream.onAbort(() => {
      open = false;
      unsubscribe();
      wake?.();
    });
    await stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
    while (open) {
      while (queue.length && open) {
        await stream.writeSSE({ data: JSON.stringify(queue.shift()) });
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 25_000);
      });
      wake = null;
      if (open && queue.length === 0) await stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
    }
    unsubscribe();
  });
});

// ---------------------------------------------------------- notifications --

api.get("/notifications", (c) => c.json({ notifications: unreadNotifications(c.get("user").id) }));

api.post("/notifications/read", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const stmt = db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?");
  for (const id of ids) stmt.run(Date.now(), id, user.id);
  return c.json({ ok: true });
});

// ------------------------------------- access tokens for plain git clients --

api.get("/tokens", (c) => {
  const rows = db
    .prepare("SELECT id, name, created_at, last_used_at FROM tokens WHERE user_id = ? ORDER BY created_at DESC")
    .all(c.get("user").id) as { id: string; name: string; created_at: number; last_used_at: number | null }[];
  return c.json({
    tokens: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at })),
  });
});

api.post("/tokens", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 60) || "Git access";
  const token = "mgn_" + crypto.randomBytes(24).toString("base64url");
  const id = nanoid();
  db.prepare("INSERT INTO tokens (id, user_id, name, hash, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    user.id,
    name,
    hashToken(token),
    Date.now(),
  );
  // The token itself is shown once and never stored.
  return c.json({ id, name, token });
});

api.delete("/tokens/:id", (c) => {
  db.prepare("DELETE FROM tokens WHERE id = ? AND user_id = ?").run(c.req.param("id"), c.get("user").id);
  return c.json({ ok: true });
});

export { getUser };
