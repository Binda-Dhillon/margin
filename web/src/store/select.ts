import { noteText, parseRef } from "../core/notefile";
import type { Access, Board, Card, Note } from "../core/types";
import { useApp } from "./app";

const textCache = new WeakMap<Note, string>();

export function textOf(note: Note): string {
  let t = textCache.get(note);
  if (t === undefined) {
    t = noteText(note);
    textCache.set(note, t);
  }
  return t;
}

/** The group copy of one of my own notes is hidden in favour of the original. */
export function isOwnSharedCopy(note: Note, userId: string | undefined): boolean {
  return !!note.meta.sharedOwner && note.meta.sharedOwner === userId;
}

export function isPrivateStub(note: Note, userId: string | undefined): boolean {
  return note.meta.sharedAccess === "private" && note.meta.sharedOwner !== userId;
}

export function resolveRef(fromSpace: string, ref: string): string {
  const r = parseRef(ref);
  return `${r.space ?? fromSpace}/${r.id}`;
}

function canonical(uid: string, notes: Record<string, Note>, userId: string | undefined): string {
  const note = notes[uid];
  if (note && userId && note.meta.sharedOwner === userId) {
    const p = `u:${userId}/${note.meta.id}`;
    if (notes[p]) return p;
  }
  return uid;
}

export interface LinkEntry {
  uid: string;
  note: Note;
  /** Access level when one side is a personal note published into a group. */
  access?: Access;
  /** Group id the access applies to. */
  gid?: string;
  /** True when the signed-in user owns the personal side and can change access. */
  mine?: boolean;
}

let indexFor: Record<string, Note> | null = null;
let indexUser: string | undefined;
let index = new Map<string, Set<string>>();

function linkIndex(notes: Record<string, Note>, userId: string | undefined) {
  if (indexFor === notes && indexUser === userId) return index;
  index = new Map();
  const add = (a: string, b: string) => {
    if (a === b) return;
    if (!index.has(a)) index.set(a, new Set());
    if (!index.has(b)) index.set(b, new Set());
    index.get(a)!.add(b);
    index.get(b)!.add(a);
  };
  for (const [uid, note] of Object.entries(notes)) {
    const from = canonical(uid, notes, userId);
    for (const ref of note.meta.links) {
      const to = canonical(resolveRef(note.space, ref), notes, userId);
      if (notes[to]) add(from, to);
    }
  }
  indexFor = notes;
  indexUser = userId;
  return index;
}

/** Every note linked to or from the given note. */
export function linksOf(uid: string, notes: Record<string, Note>, userId: string | undefined): LinkEntry[] {
  const idx = linkIndex(notes, userId);
  const self = notes[uid];
  if (!self) return [];
  const out: LinkEntry[] = [];
  for (const other of idx.get(uid) ?? []) {
    const note = notes[other];
    if (!note) continue;
    const entry: LinkEntry = { uid: other, note };
    const personal = self.space.startsWith("u:") ? self : note.space.startsWith("u:") ? note : null;
    const group = self.space.startsWith("g:") ? self : note.space.startsWith("g:") ? note : null;
    if (personal && group && personal !== group) {
      entry.gid = group.space.slice(2);
      entry.access = personal.meta.shares[entry.gid];
      entry.mine = true;
    } else if (note.meta.sharedOwner) {
      entry.access = note.meta.sharedAccess;
      entry.gid = note.space.slice(2);
      entry.mine = false;
    }
    out.push(entry);
  }
  return out.sort((a, b) => a.note.meta.title.localeCompare(b.note.meta.title));
}

export function linkCount(uid: string, notes: Record<string, Note>, userId: string | undefined): number {
  return linkIndex(notes, userId).get(uid)?.size ?? 0;
}

export function areLinked(a: string, b: string, notes: Record<string, Note>, userId: string | undefined): boolean {
  return linkIndex(notes, userId).get(a)?.has(b) ?? false;
}

/** Notes worth listing: no duplicates of my own shared notes. */
export function visibleNotes(notes: Record<string, Note>, userId: string | undefined): Note[] {
  return Object.values(notes).filter((n) => !isOwnSharedCopy(n, userId));
}

export interface SearchHit {
  uid: string;
  note: Note;
  snippet: string;
  inTitle: boolean;
}

export function searchNotes(query: string, notes: Record<string, Note>, userId: string | undefined, limit = 30): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: (SearchHit & { score: number })[] = [];
  for (const [uid, note] of Object.entries(notes)) {
    if (isOwnSharedCopy(note, userId) || isPrivateStub(note, userId)) continue;
    const title = note.meta.title.toLowerCase();
    const text = textOf(note);
    const lower = text.toLowerCase();
    const tags = note.meta.tags.join(" ").toLowerCase();
    if (!terms.every((t) => title.includes(t) || lower.includes(t) || tags.includes(t))) continue;
    const inTitle = terms.some((t) => title.includes(t));
    const at = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0), Infinity);
    let snippet = "";
    if (Number.isFinite(at)) {
      const start = Math.max(0, at - 40);
      snippet = (start > 0 ? "…" : "") + text.slice(start, at + 90).trim() + (at + 90 < text.length ? "…" : "");
    } else {
      snippet = text.slice(0, 110);
    }
    const score = (inTitle ? 100 : 0) + (title.startsWith(terms[0]) ? 50 : 0) + (Date.parse(note.meta.updated) || 0) / 1e13;
    hits.push({ uid, note, snippet, inTitle, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function liveCards(board: Board | undefined): Card[] {
  return board ? Object.values(board.cards).filter((c) => !c.deleted) : [];
}

/** Board cards that reference a note, used for the "Linked to" chips. */
export function cardsLinking(noteId: string, space: string, boards: Record<string, Board>): Card[] {
  return liveCards(boards[space]).filter((c) => c.notes.includes(noteId));
}

export function useUserId(): string | undefined {
  return useApp((s) => s.user?.id);
}

export function spaceLabel(space: string): string {
  const s = useApp.getState();
  if (space.startsWith("u:")) return "My notes";
  return s.spaces[space]?.name ?? s.groups.find((g) => `g:${g.id}` === space)?.name ?? "Group";
}

export function folderName(note: Note): string | null {
  if (!note.meta.folder) return null;
  const f = (useApp.getState().folders[note.space] ?? []).find((x) => x.id === note.meta.folder && !x.deleted);
  return f?.name ?? null;
}

export function memberName(userId: string | null | undefined, gid?: string): string {
  if (!userId) return "";
  const s = useApp.getState();
  if (s.user?.id === userId) return s.user.name;
  for (const g of s.groups) {
    if (gid && g.id !== gid) continue;
    const m = g.members.find((x) => x.id === userId);
    if (m) return m.name;
  }
  return "";
}
