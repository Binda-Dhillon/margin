import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

export const db = new Database(path.join(config.dataDir, "margin.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  due_label TEXT,
  due_date TEXT
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  added_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS group_members_user ON group_members(user_id);
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, read_at);
`);

export interface UserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface GroupRow {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
  invite_code: string;
  due_label: string | null;
  due_date: string | null;
}

export function getUser(id: string): UserRow | undefined {
  return db.prepare("SELECT id, name, email, image FROM user WHERE id = ?").get(id) as UserRow | undefined;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return db
    .prepare("SELECT id, name, email, image FROM user WHERE lower(email) = lower(?)")
    .get(email) as UserRow | undefined;
}

export function isMember(groupId: string, userId: string): boolean {
  return !!db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, userId);
}

export function memberIds(groupId: string): string[] {
  return (db.prepare("SELECT user_id FROM group_members WHERE group_id = ?").all(groupId) as { user_id: string }[]).map(
    (r) => r.user_id,
  );
}

export function groupsForUser(userId: string) {
  const groups = db
    .prepare(
      `SELECT g.*, m.role AS my_role FROM groups g
       JOIN group_members m ON m.group_id = g.id
       WHERE m.user_id = ? ORDER BY g.created_at`,
    )
    .all(userId) as (GroupRow & { my_role: string })[];
  const membersStmt = db.prepare(
    `SELECT u.id, u.name, u.email, u.image, m.role FROM group_members m
     JOIN user u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.created_at`,
  );
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    role: g.my_role,
    createdBy: g.created_by,
    createdAt: g.created_at,
    inviteCode: g.invite_code,
    dueLabel: g.due_label,
    dueDate: g.due_date,
    members: membersStmt.all(g.id) as (UserRow & { role: string })[],
  }));
}
