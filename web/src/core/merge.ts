import { diff3Merge } from "node-diff3";
import { parseNoteFile, parseScene, sceneText, serializeNoteFile } from "./notefile";
import type { Board, Card, Folder, NoteMeta, Settings } from "./types";
import { PATHS, isConflictPath, isNotePath } from "./types";

/**
 * Three-way merges, one per file type. A space is merged file by file when two
 * members have both synced changes since their last common version.
 *
 * `base` is the common ancestor, `ours` is this device, `theirs` is what the
 * server has. `null` means the file does not exist on that side.
 */

export interface MergeResult {
  /** Merged content, or null when the file should not exist. */
  content: string | null;
  /** Extra files to write, used to keep the other version after a clash. */
  extra?: { path: string; content: string | null }[];
  /** True when the two sides could not be combined automatically. */
  conflict?: boolean;
}

// ------------------------------------------------------------- helpers ----

function pick3<T>(base: T, ours: T, theirs: T, preferTheirs: boolean): T {
  const same = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
  if (same(ours, theirs)) return ours;
  if (same(ours, base)) return theirs;
  if (same(theirs, base)) return ours;
  return preferTheirs ? theirs : ours;
}

function mergeSet(base: string[], ours: string[], theirs: string[]): string[] {
  const b = new Set(base);
  const o = new Set(ours);
  const t = new Set(theirs);
  const out: string[] = [];
  for (const item of [...ours, ...theirs]) {
    if (out.includes(item)) continue;
    const keptByOurs = o.has(item) || !b.has(item);
    const keptByTheirs = t.has(item) || !b.has(item);
    // An item survives unless one side removed something that was in the base.
    if (b.has(item) ? o.has(item) && t.has(item) : keptByOurs || keptByTheirs) out.push(item);
  }
  return out;
}

function mergeRecord<T>(
  base: Record<string, T>,
  ours: Record<string, T>,
  theirs: Record<string, T>,
  preferTheirs: boolean,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const value = pick3(base[key], ours[key], theirs[key], preferTheirs);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function mergeById<T extends { id: string }>(base: T[], ours: T[], theirs: T[], preferTheirs: boolean): T[] {
  const b = new Map(base.map((x) => [x.id, x]));
  const o = new Map(ours.map((x) => [x.id, x]));
  const t = new Map(theirs.map((x) => [x.id, x]));
  const ids = [...ours.map((x) => x.id), ...theirs.map((x) => x.id).filter((id) => !o.has(id))];
  const out: T[] = [];
  for (const id of ids) {
    const mine = o.get(id);
    const yours = t.get(id);
    const was = b.get(id);
    if (was && (!mine || !yours)) continue; // removed on one side
    if (mine && yours) out.push(pick3(was as T, mine, yours, preferTheirs));
    else out.push((mine ?? yours)!);
  }
  return out;
}

/** Line-based diff3. Returns null when the same region changed on both sides. */
export function mergeText(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours;
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  const regions = diff3Merge(ours.split("\n"), base.split("\n"), theirs.split("\n"));
  const lines: string[] = [];
  for (const region of regions) {
    if (region.ok) lines.push(...region.ok);
    else if (region.conflict) {
      const a = region.conflict.a.join("\n");
      const b = region.conflict.b.join("\n");
      if (a === b) lines.push(...region.conflict.a);
      else return null;
    }
  }
  return lines.join("\n");
}

function newer(a: string, b: string): boolean {
  return (Date.parse(a) || 0) > (Date.parse(b) || 0);
}

// --------------------------------------------------------------- notes ----

function mergeMeta(base: NoteMeta | null, ours: NoteMeta, theirs: NoteMeta): NoteMeta {
  const preferTheirs = newer(theirs.updated, ours.updated);
  const b = base ?? ours;
  const out: NoteMeta = { ...ours };
  const keys = new Set([...Object.keys(ours), ...Object.keys(theirs)]) as Set<keyof NoteMeta>;
  for (const key of keys) {
    if (key === "tags" || key === "links") {
      out[key] = mergeSet(base ? base[key] : [], ours[key], theirs[key]);
    } else if (key === "shares") {
      out.shares = mergeRecord(base?.shares ?? {}, ours.shares, theirs.shares, preferTheirs);
    } else if (key === "updated" || key === "updatedById" || key === "updatedByName") {
      continue;
    } else {
      (out as unknown as Record<string, unknown>)[key] = pick3(b[key], ours[key], theirs[key], preferTheirs);
    }
  }
  const latest = preferTheirs ? theirs : ours;
  out.updated = latest.updated;
  out.updatedById = latest.updatedById;
  out.updatedByName = latest.updatedByName;
  return out;
}

function mergeTextNote(path: string, base: string | null, ours: string, theirs: string): MergeResult {
  const o = parseNoteFile(path, ours);
  const t = parseNoteFile(path, theirs);
  const b = base !== null ? parseNoteFile(path, base) : null;
  const meta = mergeMeta(b?.meta ?? null, o.meta, t.meta);
  const body = mergeText(b?.body ?? "", o.body, t.body);
  if (body !== null) return { content: serializeNoteFile(meta, body) };
  // Same lines changed on both devices: keep ours in place and theirs beside it.
  return {
    content: serializeNoteFile({ ...meta, updated: o.meta.updated, updatedById: o.meta.updatedById, updatedByName: o.meta.updatedByName }, o.body),
    extra: [{ path: PATHS.conflictOf(path), content: serializeNoteFile(t.meta, t.body) }],
    conflict: true,
  };
}

type Element = Record<string, unknown> & { id: string; version?: number; versionNonce?: number };

/** Excalidraw's own rule: per element, the higher version wins. */
export function mergeElements(ours: Element[], theirs: Element[]): Element[] {
  const byId = new Map<string, Element>();
  const order: string[] = [];
  for (const el of ours) {
    byId.set(el.id, el);
    order.push(el.id);
  }
  for (const el of theirs) {
    const mine = byId.get(el.id);
    if (!mine) {
      byId.set(el.id, el);
      order.push(el.id);
      continue;
    }
    const mv = mine.version ?? 0;
    const tv = el.version ?? 0;
    if (tv > mv || (tv === mv && (el.versionNonce ?? 0) < (mine.versionNonce ?? 0))) byId.set(el.id, el);
  }
  return order.map((id) => byId.get(id)!);
}

function mergeDrawing(path: string, base: string | null, ours: string, theirs: string): MergeResult {
  const o = parseNoteFile(path, ours);
  const t = parseNoteFile(path, theirs);
  const b = base !== null ? parseNoteFile(path, base) : null;
  const meta = mergeMeta(b?.meta ?? null, o.meta, t.meta);
  const so = parseScene(ours);
  const st = parseScene(theirs);
  return {
    content: sceneText(meta, {
      elements: mergeElements(so.elements as Element[], st.elements as Element[]),
      appState: so.appState,
      files: { ...st.files, ...so.files },
    }),
  };
}

// --------------------------------------------------------------- board ----

export function parseBoard(text: string | null): Board {
  if (text) {
    try {
      const json = JSON.parse(text);
      if (json && Array.isArray(json.columns) && json.cards) return json as Board;
    } catch {
      /* fall through to an empty board */
    }
  }
  return { version: 1, columns: [], cards: {} };
}

function mergeCard(base: Card | undefined, ours: Card, theirs: Card): Card {
  const preferTheirs = newer(theirs.updated, ours.updated);
  const out = { ...ours } as unknown as Record<string, unknown>;
  const o = ours as unknown as Record<string, unknown>;
  const t = theirs as unknown as Record<string, unknown>;
  const b = (base ?? ours) as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(o), ...Object.keys(t)])) {
    if (key === "checklist" || key === "comments") {
      type Item = { id: string };
      out[key] = mergeById((b[key] as Item[]) ?? [], (o[key] as Item[]) ?? [], (t[key] as Item[]) ?? [], preferTheirs);
    } else if (key === "notes") {
      out[key] = mergeSet((base?.notes ?? []) as string[], ours.notes ?? [], theirs.notes ?? []);
    } else {
      out[key] = pick3(b[key], o[key], t[key], preferTheirs);
    }
  }
  return out as unknown as Card;
}

function mergeBoard(base: string | null, ours: string, theirs: string): MergeResult {
  const b = parseBoard(base);
  const o = parseBoard(ours);
  const t = parseBoard(theirs);
  const cards: Record<string, Card> = {};
  for (const id of new Set([...Object.keys(o.cards), ...Object.keys(t.cards)])) {
    const mine = o.cards[id];
    const yours = t.cards[id];
    if (mine && yours) cards[id] = mergeCard(b.cards[id], mine, yours);
    else if (mine) {
      if (!b.cards[id]) cards[id] = mine;
    } else if (yours && !b.cards[id]) cards[id] = yours;
  }
  const columns = [...o.columns];
  for (const col of t.columns) if (!columns.some((c) => c.id === col.id)) columns.push(col);
  return { content: JSON.stringify({ version: 1, columns, cards }, null, 1) + "\n" };
}

// ------------------------------------------------- folders and settings ----

function mergeFolders(base: string | null, ours: string, theirs: string): MergeResult {
  const read = (s: string | null): Folder[] => {
    try {
      return s ? (JSON.parse(s).folders as Folder[]) ?? [] : [];
    } catch {
      return [];
    }
  };
  void base;
  const out = new Map<string, Folder>();
  for (const f of [...read(ours), ...read(theirs)]) {
    const existing = out.get(f.id);
    if (!existing || newer(f.updated, existing.updated)) out.set(f.id, f);
  }
  return { content: JSON.stringify({ folders: [...out.values()] }, null, 1) + "\n" };
}

function mergeSettings(base: string | null, ours: string, theirs: string): MergeResult {
  const read = (s: string | null): Partial<Settings> => {
    try {
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  };
  const o = read(ours);
  const t = read(theirs);
  const merged = mergeRecord(
    read(base) as Record<string, unknown>,
    o as Record<string, unknown>,
    t as Record<string, unknown>,
    newer(t.updated ?? "", o.updated ?? ""),
  );
  return { content: JSON.stringify(merged, null, 1) + "\n" };
}

// ------------------------------------------------------------ dispatch ----

export function mergeFile(path: string, base: string | null, ours: string | null, theirs: string | null): MergeResult {
  if (ours === theirs) return { content: ours };
  if (ours === base) return { content: theirs };
  if (theirs === base) return { content: ours };
  // One side deleted while the other kept working: keep the work.
  if (ours === null) return { content: theirs };
  if (theirs === null) return { content: ours };

  if (path === PATHS.board) return mergeBoard(base, ours, theirs);
  if (path === PATHS.folders) return mergeFolders(base, ours, theirs);
  if (path === PATHS.settings) return mergeSettings(base, ours, theirs);
  if (isConflictPath(path)) return { content: theirs };
  if (isNotePath(path)) {
    return path.endsWith(".excalidraw") ? mergeDrawing(path, base, ours, theirs) : mergeTextNote(path, base, ours, theirs);
  }
  const text = mergeText(base ?? "", ours, theirs);
  return { content: text ?? ours, conflict: text === null };
}
