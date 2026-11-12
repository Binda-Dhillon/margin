import { create } from "zustand";
import { api, ApiError, authClient, type Group, type Me, type ServerConfig, type ServerNotification, type User } from "../lib/api";
import { createEnv, wipeLocal } from "../lib/gitenv";
import { clamp, inQuietHours, isoDate, newId } from "../lib/util";
import { mergeFile, parseBoard } from "../core/merge";
import { blankMeta, noteFromFile, parseRef, privateStub, serializeNoteFile } from "../core/notefile";
import { AccessError, OfflineError, SpaceRepo, type GitEnv } from "../core/repo";
import {
  DEFAULT_COLUMNS,
  DEFAULT_SETTINGS,
  PATHS,
  isConflictPath,
  isNotePath,
  type Access,
  type Board,
  type Card,
  type Folder,
  type Note,
  type NoteMeta,
  type NoteType,
  type Settings,
} from "../core/types";

// ------------------------------------------------------------------ types --

export interface SpaceInfo {
  key: string;
  kind: "personal" | "group";
  id: string;
  name: string;
  loaded: boolean;
  syncing: boolean;
  syncedAt: number | null;
  /** Local commits or edits are waiting for the server. */
  pending: boolean;
  error: string | null;
}

export interface WindowState {
  uid: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  min: boolean;
  max: boolean;
}

export type GroupTab = "board" | "notes" | "members" | "history";

export type View =
  | { kind: "canvas" }
  | { kind: "folder"; folder: string | null }
  | { kind: "group"; group: string; tab: GroupTab }
  | { kind: "graph" }
  | { kind: "daily"; date: string }
  | { kind: "history" };

export type Dialog =
  | { kind: "link"; uid: string }
  | { kind: "settings"; section?: string }
  | { kind: "newGroup" }
  | { kind: "joinGroup" }
  | { kind: "newFolder"; rename?: string }
  | { kind: "invite"; group: string }
  | { kind: "card"; space: string; cardId: string }
  | { kind: "noteHistory"; uid: string }
  | { kind: "confirm"; title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void };

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone?: "info" | "warn";
  action?: { label: string; run: () => void };
}

export interface FocusState {
  uid: string;
  phase: "running" | "done" | "break";
  endsAt: number;
  minutes: number;
  startedAt: number;
}

interface AppState {
  status: "loading" | "signedOut" | "ready" | "error";
  bootError: string | null;
  config: ServerConfig | null;
  offline: boolean;
  user: User | null;
  groups: Group[];
  serverNotes: ServerNotification[];
  spaces: Record<string, SpaceInfo>;
  notes: Record<string, Note>;
  /** Bumped whenever a note's content was replaced from outside its editor. */
  revs: Record<string, number>;
  folders: Record<string, Folder[]>;
  boards: Record<string, Board>;
  settings: Settings;
  savedAt: Record<string, number>;
  view: View;
  context: { space: string; folder: string | null };
  windows: WindowState[];
  activeUid: string | null;
  recent: string[];
  dialog: Dialog | null;
  focus: FocusState | null;
  toasts: Toast[];
  held: Toast[];
  findUid: string | null;
  searchFocus: number;
  canvas: { w: number; h: number };
  now: number;
}

export const useApp = create<AppState>(() => ({
  status: "loading",
  bootError: null,
  config: null,
  offline: false,
  user: null,
  groups: [],
  serverNotes: [],
  spaces: {},
  notes: {},
  revs: {},
  folders: {},
  boards: {},
  settings: DEFAULT_SETTINGS,
  savedAt: {},
  view: { kind: "canvas" },
  context: { space: "", folder: null },
  windows: [],
  activeUid: null,
  recent: [],
  dialog: null,
  focus: null,
  toasts: [],
  held: [],
  findUid: null,
  searchFocus: 0,
  canvas: { w: 1200, h: 760 },
  now: Date.now(),
}));

const get = useApp.getState;
const set = useApp.setState;

// ----------------------------------------------------- non-reactive state --

let env: GitEnv | null = null;
const repos = new Map<string, SpaceRepo>();
const unsaved = new Set<string>();
const lastFlushed = new Map<string, string>();
const labels = new Map<string, Set<string>>();
const syncing = new Set<string>();
const syncAgain = new Set<string>();
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushing: Promise<void> | null = null;
let events: EventSource | null = null;
let uiTimer: ReturnType<typeof setTimeout> | undefined;

export const uidOf = (note: Note) => `${note.space}/${note.meta.id}`;
export const personalKey = () => `u:${get().user?.id ?? ""}`;
export const groupKey = (id: string) => `g:${id}`;
export const spaceOfUid = (uid: string) => uid.slice(0, uid.indexOf("/"));
export const idOfUid = (uid: string) => uid.slice(uid.indexOf("/") + 1);
export const repoFor = (space: string) => repos.get(space) ?? null;

function me(): User {
  const user = get().user;
  if (!user) throw new Error("Not signed in");
  return user;
}

function nowIso() {
  return new Date().toISOString();
}

// ------------------------------------------------------------------ toasts --

function quiet(): boolean {
  const s = get();
  if (s.focus && s.focus.phase === "running") return true;
  return s.settings.quietHours.on && inQuietHours(s.settings.quietHours.from, s.settings.quietHours.to);
}

export function toast(t: Omit<Toast, "id">, opts: { urgent?: boolean } = {}) {
  const item: Toast = { ...t, id: newId("t") };
  if (!opts.urgent && quiet()) {
    set((s) => ({ held: [...s.held, item] }));
    return;
  }
  set((s) => ({ toasts: [...s.toasts.slice(-3), item] }));
  setTimeout(() => dismissToast(item.id), 7000);
}

export function dismissToast(id: string) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function releaseHeld() {
  const held = get().held;
  if (!held.length || quiet()) return;
  set({ held: [] });
  if (held.length === 1) toast(held[0], { urgent: true });
  else toast({ title: `${held.length} updates while you were focused`, body: held.map((h) => h.title).slice(0, 3).join(" · ") }, { urgent: true });
}

// ------------------------------------------------------------------- boot --

export async function boot() {
  set({ status: "loading", bootError: null });
  try {
    const config = await api<ServerConfig>("GET", "/api/config");
    set({ config });
  } catch {
    /* offline start is handled below */
  }
  try {
    const data = await api<Me>("GET", "/api/me");
    localStorage.setItem("margin-session", JSON.stringify(data));
    await enter(data, false);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      localStorage.removeItem("margin-session");
      set({ status: "signedOut" });
      return;
    }
    const cached = localStorage.getItem("margin-session");
    if (cached) {
      await enter(JSON.parse(cached) as Me, true);
      return;
    }
    set({ status: "error", bootError: err instanceof Error ? err.message : "Could not start Margin" });
  }
}

async function enter(data: Me, offline: boolean) {
  const user = data.user;
  env = createEnv(user.id);
  repos.clear();
  const pKey = `u:${user.id}`;
  const ui = loadUi(user.id);
  set({
    user,
    groups: data.groups,
    serverNotes: data.notifications,
    offline,
    spaces: {},
    notes: {},
    folders: {},
    boards: {},
    context: ui?.context ?? { space: pKey, folder: null },
    windows: ui?.windows ?? [],
    recent: ui?.recent ?? [],
    view: { kind: "canvas" },
  });
  try {
    await openSpace(pKey, "My notes", "personal");
  } catch (err) {
    set({
      status: "error",
      bootError:
        err instanceof OfflineError
          ? "Margin needs a connection the first time you sign in on a device."
          : err instanceof Error
            ? err.message
            : "Could not open your notes",
    });
    return;
  }
  applySettings(get().settings);
  set({ status: "ready" });
  startTicker();
  // Groups load in the background so the canvas appears straight away.
  for (const g of data.groups) void openSpace(groupKey(g.id), g.name, "group").catch(() => undefined);
  startEvents();
  void syncAll();
  const invite = new URLSearchParams(window.location.search).get("join");
  if (invite) {
    window.history.replaceState(null, "", window.location.pathname);
    void joinGroup(invite);
  }
}

function setSpace(key: string, patch: Partial<SpaceInfo>) {
  set((s) => (s.spaces[key] ? { spaces: { ...s.spaces, [key]: { ...s.spaces[key], ...patch } } } : {}));
}

async function openSpace(key: string, name: string, kind: "personal" | "group") {
  if (!env) return;
  const user = me();
  if (!repos.has(key)) repos.set(key, new SpaceRepo(env, key, { id: user.id, name: user.name, email: user.email }));
  set((s) => ({
    spaces: {
      ...s.spaces,
      [key]: s.spaces[key] ?? {
        key,
        kind,
        id: key.slice(2),
        name,
        loaded: false,
        syncing: false,
        syncedAt: null,
        pending: false,
        error: null,
      },
    },
  }));
  const repo = repos.get(key)!;
  await repo.open();
  await loadSpace(key);
  setSpace(key, { loaded: true, name, pending: repo.hasLocalChanges() });
}

async function loadSpace(key: string) {
  const repo = repos.get(key);
  if (!repo) return;
  const files = await repo.list();
  const loaded: Record<string, Note> = {};
  const conflicts: { path: string; text: string }[] = [];
  let folders: Folder[] = [];
  let board: Board | null = null;
  let settings: Settings | null = null;
  for (const path of files) {
    if (path === PATHS.folders) {
      folders = readFolders(await repo.read(path));
    } else if (path === PATHS.board) {
      board = parseBoard(await repo.read(path));
    } else if (path === PATHS.settings && key.startsWith("u:")) {
      settings = readSettings(await repo.read(path));
    } else if (isNotePath(path)) {
      const text = await repo.read(path);
      if (text === null) continue;
      if (isConflictPath(path)) conflicts.push({ path, text });
      else {
        const note = noteFromFile(key, path, text);
        loaded[uidOf(note)] = note;
        lastFlushed.set(uidOf(note), text);
      }
    }
  }
  for (const c of conflicts) {
    const other = noteFromFile(key, c.path, c.text);
    const target = loaded[`${key}/${other.meta.id}`];
    if (target) target.conflict = { meta: other.meta, body: other.body, path: c.path };
  }
  set((s) => {
    const notes = { ...s.notes };
    for (const uid of Object.keys(notes)) if (notes[uid].space === key && !unsaved.has(uid)) delete notes[uid];
    for (const [uid, note] of Object.entries(loaded)) if (!unsaved.has(uid)) notes[uid] = note;
    return {
      notes,
      folders: { ...s.folders, [key]: folders },
      boards: { ...s.boards, [key]: normaliseBoard(board) },
      ...(settings ? { settings } : {}),
    };
  });
}

function readFolders(text: string | null): Folder[] {
  try {
    return text ? ((JSON.parse(text).folders as Folder[]) ?? []) : [];
  } catch {
    return [];
  }
}

function readSettings(text: string | null): Settings {
  try {
    const raw = text ? JSON.parse(text) : {};
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      quietHours: { ...DEFAULT_SETTINGS.quietHours, ...(raw.quietHours ?? {}) },
      tips: { ...DEFAULT_SETTINGS.tips, ...(raw.tips ?? {}) },
      checklist: { ...DEFAULT_SETTINGS.checklist, ...(raw.checklist ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function normaliseBoard(board: Board | null): Board {
  if (!board || board.columns.length === 0) return { version: 1, columns: DEFAULT_COLUMNS, cards: board?.cards ?? {} };
  return board;
}

// ------------------------------------------------------------ UI storage --

interface UiState {
  windows: WindowState[];
  recent: string[];
  context: { space: string; folder: string | null };
}

function loadUi(userId: string): UiState | null {
  try {
    const raw = localStorage.getItem(`margin-ui-${userId}`);
    return raw ? (JSON.parse(raw) as UiState) : null;
  } catch {
    return null;
  }
}

function saveUiSoon() {
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    const s = get();
    if (!s.user) return;
    const ui: UiState = { windows: s.windows, recent: s.recent, context: s.context };
    localStorage.setItem(`margin-ui-${s.user.id}`, JSON.stringify(ui));
  }, 400);
}

let ticker: ReturnType<typeof setInterval> | undefined;
function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    set({ now: Date.now() });
    releaseHeld();
  }, 30_000);
}

// --------------------------------------------------------------- settings --

let mediaBound = false;
export function applySettings(s: Settings) {
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const dark = s.theme === "dark" || (s.theme === "system" && systemDark.matches);
  root.classList.toggle("dark", dark);
  root.classList.toggle("hc", s.highContrast);
  root.classList.toggle("reduce-motion", s.reduceMotion);
  root.style.setProperty("--accent", s.accent);
  root.style.setProperty("--text-size", String(s.textSize));
  root.style.setProperty("--font", `"${s.font === "Inter" ? "Inter Variable" : s.font}", "Inter Variable", system-ui, sans-serif`);
  if (!mediaBound) {
    mediaBound = true;
    systemDark.addEventListener("change", () => applySettings(get().settings));
  }
}

export function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function updateSettings(patch: Partial<Settings>) {
  const settings: Settings = { ...get().settings, ...patch, updated: nowIso() };
  set({ settings });
  applySettings(settings);
  void writeFile(personalKey(), PATHS.settings, JSON.stringify(settings, null, 1) + "\n", "Update settings");
}

// ------------------------------------------------------------ file writes --

function addLabel(space: string, label: string) {
  if (!label) return;
  if (!labels.has(space)) labels.set(space, new Set());
  labels.get(space)!.add(label);
}

function takeMessage(space: string): string {
  const list = [...(labels.get(space) ?? [])];
  labels.delete(space);
  if (list.length === 0) return "Update notes";
  if (list.length <= 3) return list.join("; ");
  return `${list.slice(0, 3).join("; ")}; and ${list.length - 3} more`;
}

async function writeFile(space: string, path: string, content: string | null, label: string) {
  const repo = repos.get(space);
  if (!repo) return;
  if (content === null) await repo.remove(path);
  else await repo.write(path, content);
  addLabel(space, label);
  setSpace(space, { pending: true });
  scheduleSync(space);
}

function markUnsaved(uid: string, label: string) {
  unsaved.add(uid);
  addLabel(spaceOfUid(uid), label);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), 700);
}

/** Writes every edited note to this device's folder, then queues a sync. */
export function flush(): Promise<void> {
  clearTimeout(flushTimer);
  if (flushing) return flushing.then(() => (unsaved.size ? flush() : undefined));
  flushing = (async () => {
    for (const space of [...boardTimers.keys()]) await flushBoard(space);
    const batch = [...unsaved];
    unsaved.clear();
    const touched = new Set<string>();
    const saved: Record<string, number> = {};
    for (const uid of batch) {
      const note = get().notes[uid];
      const repo = repos.get(spaceOfUid(uid));
      if (!note || !repo) continue;
      const text = serializeNoteFile(note.meta, note.body);
      if (lastFlushed.get(uid) !== text) {
        await repo.write(note.path, text);
        lastFlushed.set(uid, text);
        touched.add(note.space);
      }
      saved[uid] = Date.now();
      if (note.space.startsWith("u:")) for (const g of await publishShares(note)) touched.add(g);
    }
    set((s) => ({ savedAt: { ...s.savedAt, ...saved } }));
    for (const space of touched) {
      setSpace(space, { pending: true });
      scheduleSync(space);
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

// ------------------------------------------------------------------ sync ---

export function scheduleSync(space: string, delay = 2500) {
  clearTimeout(syncTimers.get(space));
  syncTimers.set(
    space,
    setTimeout(() => void syncSpace(space), delay),
  );
}

export async function syncAll() {
  await Promise.all([...repos.keys()].map((key) => syncSpace(key)));
}

export async function syncSpace(space: string) {
  const repo = repos.get(space);
  if (!repo || !get().spaces[space]?.loaded) return;
  if (syncing.has(space)) {
    syncAgain.add(space);
    return;
  }
  clearTimeout(syncTimers.get(space));
  syncing.add(space);
  setSpace(space, { syncing: true });
  try {
    await flush();
    const result = await repo.sync(takeMessage(space));
    await applyChanges(space, result.changed);
    if (result.conflicts.length) {
      toast(
        {
          title: result.conflicts.length === 1 ? "Two versions of a note were kept" : `Two versions of ${result.conflicts.length} notes were kept`,
          body: "You and someone else edited the same lines. Open the note to choose which to keep.",
          tone: "warn",
        },
        { urgent: true },
      );
    }
    setSpace(space, { syncing: false, syncedAt: Date.now(), pending: false, error: null });
    if (get().offline) set({ offline: false });
  } catch (err) {
    if (err instanceof OfflineError) {
      await applyChanges(space, err.result.changed);
      setSpace(space, { syncing: false, pending: true });
      if (!get().offline) set({ offline: true });
    } else if (err instanceof AccessError && (err.status === 401 || err.status === 403 || err.status === 404)) {
      setSpace(space, { syncing: false, error: err.message });
      if (err.status === 401) void boot();
      else void refreshGroups();
    } else {
      console.error("sync failed", space, err);
      setSpace(space, { syncing: false, error: err instanceof Error ? err.message : "Sync failed" });
    }
  } finally {
    syncing.delete(space);
    if (syncAgain.delete(space)) scheduleSync(space, 300);
  }
}

/** Reloads files that a pull or merge changed and reconciles open notes. */
async function applyChanges(space: string, paths: string[]) {
  const repo = repos.get(space);
  if (!repo || paths.length === 0) return;
  const user = me();
  let othersEdited = 0;
  let lastEditor = "";
  for (const path of paths) {
    const text = await repo.read(path);
    if (path === PATHS.folders) {
      set((s) => ({ folders: { ...s.folders, [space]: readFolders(text) } }));
    } else if (path === PATHS.board) {
      if (boardTimers.has(space)) {
        const mine = JSON.stringify(get().boards[space]);
        const merged = mergeFile(path, null, mine, text ?? mine);
        set((s) => ({ boards: { ...s.boards, [space]: normaliseBoard(parseBoard(merged.content)) } }));
      } else {
        set((s) => ({ boards: { ...s.boards, [space]: normaliseBoard(parseBoard(text)) } }));
      }
    } else if (path === PATHS.settings && space.startsWith("u:")) {
      const settings = readSettings(text);
      set({ settings });
      applySettings(settings);
    } else if (isNotePath(path)) {
      if (isConflictPath(path)) {
        const original = path.replace(".conflict.", ".");
        const id = original.split("/").pop()!.replace(/\.(md|excalidraw)$/, "");
        const uid = `${space}/${id}`;
        set((s) => {
          const note = s.notes[uid];
          if (!note) return {};
          const other = text === null ? null : noteFromFile(space, path, text);
          return { notes: { ...s.notes, [uid]: { ...note, conflict: other ? { meta: other.meta, body: other.body, path } : null } } };
        });
        continue;
      }
      const id = path.split("/").pop()!.replace(/\.(md|excalidraw)$/, "");
      const uid = `${space}/${id}`;
      if (text === null) {
        lastFlushed.delete(uid);
        unsaved.delete(uid);
        set((s) => {
          const notes = { ...s.notes };
          delete notes[uid];
          return { notes, windows: s.windows.filter((w) => w.uid !== uid), recent: s.recent.filter((r) => r !== uid) };
        });
        continue;
      }
      let incoming = noteFromFile(space, path, text);
      const current = get().notes[uid];
      if (current && unsaved.has(uid)) {
        // Typed while the sync was running: fold those keystrokes into the merged file.
        const mine = serializeNoteFile(current.meta, current.body);
        const merged = mergeFile(path, lastFlushed.get(uid) ?? null, mine, text);
        incoming = noteFromFile(space, path, merged.content ?? mine);
      }
      incoming.conflict = current?.conflict ?? null;
      lastFlushed.set(uid, text);
      if (incoming.meta.updatedById && incoming.meta.updatedById !== user.id) {
        othersEdited++;
        lastEditor = incoming.meta.updatedByName;
      }
      // A note that its owner has just made private can no longer stay open here.
      const nowLocked = incoming.meta.sharedAccess === "private" && incoming.meta.sharedOwner !== user.id;
      if (nowLocked) unsaved.delete(uid);
      set((s) => ({
        notes: { ...s.notes, [uid]: incoming },
        revs: { ...s.revs, [uid]: (s.revs[uid] ?? 0) + 1 },
        ...(nowLocked ? { windows: s.windows.filter((w) => w.uid !== uid), recent: s.recent.filter((r) => r !== uid), activeUid: s.activeUid === uid ? null : s.activeUid } : {}),
      }));
      if (space.startsWith("g:")) adoptSharedEdit(incoming);
    }
  }
  if (othersEdited && space.startsWith("g:") && get().settings.notifyGroupChanges) {
    const name = get().spaces[space]?.name ?? "your group";
    toast({
      title: `${lastEditor} updated ${othersEdited === 1 ? "a note" : `${othersEdited} notes`} in ${name}`,
      action: { label: "Open group", run: () => openGroup(space.slice(2), "notes") },
    });
  }
}

function startEvents() {
  events?.close();
  events = new EventSource("/api/events");
  events.onopen = () => {
    if (get().offline) {
      set({ offline: false });
      void syncAll();
    }
  };
  events.onmessage = (e) => {
    let data: { type: string; space?: string; by?: { id: string }; notification?: ServerNotification };
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    if (data.type === "repo" && data.space) scheduleSync(data.space, 250);
    if (data.type === "groups") void refreshGroups();
    if (data.type === "notification" && data.notification) {
      const n = data.notification;
      set((s) => ({ serverNotes: [n, ...s.serverNotes.filter((x) => x.id !== n.id)] }));
    }
  };
  events.onerror = () => {
    if (!get().offline && !navigator.onLine) set({ offline: true });
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void syncAll());
  window.addEventListener("offline", () => set({ offline: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && get().status === "ready") void syncAll();
    else void flush();
  });
  window.addEventListener("beforeunload", () => void flush());
  setInterval(() => {
    if (get().status === "ready") void syncAll();
  }, 60_000);
}

// ---------------------------------------------------------------- groups ---

export async function refreshGroups() {
  let data: Me;
  try {
    data = await api<Me>("GET", "/api/me");
  } catch {
    return;
  }
  localStorage.setItem("margin-session", JSON.stringify(data));
  const before = new Set(get().groups.map((g) => g.id));
  const after = new Set(data.groups.map((g) => g.id));
  set({ groups: data.groups, serverNotes: data.notifications });
  for (const g of data.groups) {
    if (!before.has(g.id)) void openSpace(groupKey(g.id), g.name, "group").then(() => syncSpace(groupKey(g.id)));
    else setSpace(groupKey(g.id), { name: g.name });
  }
  for (const id of before) {
    if (after.has(id)) continue;
    const key = groupKey(id);
    const repo = repos.get(key);
    repos.delete(key);
    void repo?.destroy();
    set((s) => {
      const notes = { ...s.notes };
      for (const uid of Object.keys(notes)) if (notes[uid].space === key) delete notes[uid];
      const spaces = { ...s.spaces };
      delete spaces[key];
      const view: View = s.view.kind === "group" && s.view.group === id ? { kind: "canvas" } : s.view;
      return {
        notes,
        spaces,
        view,
        windows: s.windows.filter((w) => !w.uid.startsWith(key + "/")),
        recent: s.recent.filter((r) => !r.startsWith(key + "/")),
        context: s.context.space === key ? { space: personalKey(), folder: null } : s.context,
      };
    });
  }
}

export async function createGroup(name: string): Promise<string> {
  const { group } = await api<{ group: Group }>("POST", "/api/groups", { name });
  await refreshGroups();
  openGroup(group.id, "board");
  return group.id;
}

export async function joinGroup(code: string) {
  try {
    const { groupId } = await api<{ groupId: string }>("POST", "/api/groups/join", { code });
    await refreshGroups();
    openGroup(groupId, "board");
  } catch (err) {
    toast({ title: "Could not join the group", body: err instanceof Error ? err.message : undefined, tone: "warn" }, { urgent: true });
  }
}

export async function dismissServerNote(id: string) {
  set((s) => ({ serverNotes: s.serverNotes.filter((n) => n.id !== id) }));
  await api("POST", "/api/notifications/read", { ids: [id] }).catch(() => undefined);
}

// ------------------------------------------------------------------ notes --

export function createNote(
  type: NoteType,
  opts: { space?: string; folder?: string | null; title?: string; body?: string; date?: string; open?: boolean; meta?: Partial<NoteMeta> } = {},
): string {
  const user = me();
  const ctx = get().context;
  const space = type === "daily" ? personalKey() : opts.space ?? ctx.space ?? personalKey();
  const id = type === "daily" ? opts.date! : newId(type === "drawing" ? "d" : "n");
  const meta: NoteMeta = {
    ...blankMeta(id, type),
    folder: space.startsWith("u:") && type !== "daily" ? (opts.folder !== undefined ? opts.folder : space === ctx.space ? ctx.folder : null) : null,
    updatedById: user.id,
    updatedByName: user.name,
    ...(opts.title ? { title: opts.title } : {}),
    ...(type === "daily" ? { date: opts.date, title: opts.date!, color: "blue" as const } : {}),
    ...(opts.meta ?? {}),
  };
  const path = type === "drawing" ? PATHS.drawing(id) : type === "daily" ? PATHS.daily(id) : PATHS.note(id);
  const body = opts.body ?? (type === "drawing" ? JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} }) : "");
  const note: Note = { meta, body, path, space, conflict: null };
  const uid = uidOf(note);
  set((s) => ({ notes: { ...s.notes, [uid]: note } }));
  markUnsaved(uid, `Add ${meta.title}`);
  const checklist = get().settings.checklist;
  if (type === "text" && !checklist.note) updateSettings({ checklist: { ...checklist, note: true } });
  if (type === "drawing" && !checklist.drawing) updateSettings({ checklist: { ...get().settings.checklist, drawing: true } });
  if (opts.open !== false && type !== "daily") openNote(uid);
  return uid;
}

/** True when the signed-in user may change this note. */
export function canEdit(note: Note): boolean {
  if (!note.meta.sharedOwner) return true;
  return note.meta.sharedOwner === get().user?.id || note.meta.sharedAccess === "edit";
}

export function patchNote(uid: string, patch: { meta?: Partial<NoteMeta>; body?: string }, opts: { touch?: boolean } = {}) {
  const note = get().notes[uid];
  if (!note) return;
  const user = me();
  const touch = opts.touch !== false;
  const meta: NoteMeta = {
    ...note.meta,
    ...(patch.meta ?? {}),
    ...(touch ? { updated: nowIso(), updatedById: user.id, updatedByName: user.name } : {}),
  };
  const next: Note = { ...note, meta, body: patch.body ?? note.body };
  set((s) => ({ notes: { ...s.notes, [uid]: next } }));
  markUnsaved(uid, `Edit ${meta.title}`);
}

export async function deleteNote(uid: string) {
  const note = get().notes[uid];
  if (!note) return;
  unsaved.delete(uid);
  lastFlushed.delete(uid);
  const id = note.meta.id;
  // Drop links that point at the note from elsewhere in its space.
  for (const [otherUid, other] of Object.entries(get().notes)) {
    if (other.space !== note.space || otherUid === uid) continue;
    if (other.meta.links.includes(id) || other.meta.preview === id) {
      patchNote(otherUid, { meta: { links: other.meta.links.filter((l) => l !== id), preview: other.meta.preview === id ? null : other.meta.preview } }, { touch: false });
    }
  }
  set((s) => {
    const notes = { ...s.notes };
    delete notes[uid];
    return {
      notes,
      windows: s.windows.filter((w) => w.uid !== uid),
      recent: s.recent.filter((r) => r !== uid),
      activeUid: s.activeUid === uid ? null : s.activeUid,
    };
  });
  await writeFile(note.space, note.path, null, `Delete ${note.meta.title}`);
  if (note.conflict) await writeFile(note.space, note.conflict.path, null, `Delete ${note.meta.title}`);
  if (note.space.startsWith("u:")) {
    for (const gid of Object.keys(note.meta.shares)) {
      await removeSharedCopy(note, gid);
    }
  }
  saveUiSoon();
}

export function resolveConflict(uid: string, keep: "mine" | "theirs") {
  const note = get().notes[uid];
  if (!note?.conflict) return;
  const conflict = note.conflict;
  if (keep === "theirs") {
    patchNote(uid, { body: conflict.body, meta: { title: conflict.meta.title } });
    set((s) => ({ revs: { ...s.revs, [uid]: (s.revs[uid] ?? 0) + 1 } }));
  }
  set((s) => ({ notes: { ...s.notes, [uid]: { ...s.notes[uid], conflict: null } } }));
  void writeFile(note.space, conflict.path, null, `Resolve ${note.meta.title}`);
}

/** Replace a note's content with an earlier version (kept as a new version). */
export function restoreNote(uid: string, text: string) {
  const note = get().notes[uid];
  if (!note) return;
  const old = noteFromFile(note.space, note.path, text);
  patchNote(uid, { body: old.body, meta: { title: old.meta.title } });
  set((s) => ({ revs: { ...s.revs, [uid]: (s.revs[uid] ?? 0) + 1 } }));
  addLabel(note.space, `Restore ${old.meta.title}`);
}

// ------------------------------------------------------- links and shares --

function sharedCopyOf(note: Note, gid: string, access: Access): { meta: NoteMeta; body: string } {
  const user = me();
  const gKey = groupKey(gid);
  const links = note.meta.links
    .map(parseRef)
    .filter((r) => r.space === gKey)
    .map((r) => r.id);
  let preview: string | null = null;
  if (note.meta.preview) {
    const p = parseRef(note.meta.preview);
    if (p.space === gKey) preview = p.id;
    else if (!p.space && get().notes[`${note.space}/${p.id}`]?.meta.shares[gid] && get().notes[`${note.space}/${p.id}`].meta.shares[gid] !== "private") preview = p.id;
  }
  const meta: NoteMeta = {
    ...note.meta,
    folder: null,
    shares: {},
    links,
    preview,
    sharedOwner: user.id,
    sharedOwnerName: user.name,
    sharedAccess: access,
  };
  if (access === "private") return privateStub(meta);
  return { meta, body: note.body };
}

/** Keeps the group copies of a personal note in step with the original. */
async function publishShares(note: Note): Promise<string[]> {
  const touched: string[] = [];
  for (const [gid, access] of Object.entries(note.meta.shares)) {
    const gKey = groupKey(gid);
    const repo = repos.get(gKey);
    if (!repo || !get().spaces[gKey]?.loaded) continue;
    const copy = sharedCopyOf(note, gid, access);
    const path = PATHS.shared(me().id, note.meta.id, note.meta.type);
    const text = serializeNoteFile(copy.meta, copy.body);
    const uid = `${gKey}/${note.meta.id}`;
    if (lastFlushed.get(uid) === text) continue;
    await repo.write(path, text);
    lastFlushed.set(uid, text);
    addLabel(gKey, `${access === "private" ? "Link" : "Share"} ${note.meta.title}`);
    const sharedNote: Note = { ...noteFromFile(gKey, path, text), conflict: get().notes[uid]?.conflict ?? null };
    set((s) => ({ notes: { ...s.notes, [uid]: sharedNote }, revs: { ...s.revs, [uid]: (s.revs[uid] ?? 0) + 1 } }));
    touched.push(gKey);
  }
  return touched;
}

async function removeSharedCopy(note: Note, gid: string) {
  const gKey = groupKey(gid);
  const uid = `${gKey}/${note.meta.id}`;
  lastFlushed.delete(uid);
  set((s) => {
    const notes = { ...s.notes };
    delete notes[uid];
    return { notes, windows: s.windows.filter((w) => w.uid !== uid) };
  });
  await writeFile(gKey, PATHS.shared(me().id, note.meta.id, note.meta.type), null, `Unlink ${note.meta.title}`);
}

/** A member with edit access changed our shared note: bring that back home. */
function adoptSharedEdit(shared: Note) {
  const user = get().user;
  if (!user || shared.meta.sharedOwner !== user.id || shared.meta.sharedAccess !== "edit") return;
  if (!shared.meta.updatedById || shared.meta.updatedById === user.id) return;
  const pUid = `u:${user.id}/${shared.meta.id}`;
  const original = get().notes[pUid];
  if (!original) return;
  if ((Date.parse(shared.meta.updated) || 0) <= (Date.parse(original.meta.updated) || 0)) return;
  const next: Note = {
    ...original,
    body: shared.body,
    meta: {
      ...original.meta,
      title: shared.meta.title,
      updated: shared.meta.updated,
      updatedById: shared.meta.updatedById,
      updatedByName: shared.meta.updatedByName,
    },
  };
  set((s) => ({ notes: { ...s.notes, [pUid]: next }, revs: { ...s.revs, [pUid]: (s.revs[pUid] ?? 0) + 1 } }));
  markUnsaved(pUid, `Edit ${next.meta.title}`);
}

/** If the uid is the group copy of one of our own notes, use the original. */
export function canonicalUid(uid: string): string {
  const note = get().notes[uid];
  const user = get().user;
  if (note?.meta.sharedOwner && user && note.meta.sharedOwner === user.id) {
    const pUid = `u:${user.id}/${note.meta.id}`;
    if (get().notes[pUid]) return pUid;
  }
  return uid;
}

export type LinkProblem = "same" | "cross-group" | "not-yours" | null;

export function linkProblem(aUid: string, bUid: string): LinkProblem {
  const a = get().notes[aUid];
  const b = get().notes[bUid];
  if (!a || !b || aUid === bUid) return "same";
  if (a.space === b.space) return null;
  const personal = a.space.startsWith("u:") ? a : b.space.startsWith("u:") ? b : null;
  if (!personal) return "cross-group";
  return null;
}

/**
 * Links two notes. Inside one space the link is stored on the first note.
 * Between a personal note and a group note it is stored on the personal note,
 * which is then published into the group at the chosen access level.
 */
export function linkNotes(aUid: string, bUid: string, access: Access = "view") {
  aUid = canonicalUid(aUid);
  bUid = canonicalUid(bUid);
  const a = get().notes[aUid];
  const b = get().notes[bUid];
  if (!a || !b || linkProblem(aUid, bUid)) return;
  if (a.space === b.space) {
    if (a.meta.links.includes(b.meta.id) || b.meta.links.includes(a.meta.id)) return;
    patchNote(aUid, { meta: { links: [...a.meta.links, b.meta.id] } }, { touch: false });
    return;
  }
  const [pUid, p, g] = a.space.startsWith("u:") ? [aUid, a, b] : [bUid, b, a];
  const gid = g.space.slice(2);
  const ref = `${g.space}/${g.meta.id}`;
  patchNote(
    pUid,
    {
      meta: {
        links: p.meta.links.includes(ref) ? p.meta.links : [...p.meta.links, ref],
        shares: { ...p.meta.shares, [gid]: p.meta.shares[gid] ?? access },
      },
    },
    { touch: false },
  );
}

export function unlinkNotes(aUid: string, bUid: string) {
  aUid = canonicalUid(aUid);
  bUid = canonicalUid(bUid);
  const a = get().notes[aUid];
  const b = get().notes[bUid];
  if (!a || !b) return;
  if (a.space === b.space) {
    if (a.meta.links.includes(b.meta.id)) {
      patchNote(aUid, { meta: { links: a.meta.links.filter((l) => l !== b.meta.id), preview: a.meta.preview === b.meta.id ? null : a.meta.preview } }, { touch: false });
    }
    if (b.meta.links.includes(a.meta.id)) {
      patchNote(bUid, { meta: { links: b.meta.links.filter((l) => l !== a.meta.id), preview: b.meta.preview === a.meta.id ? null : b.meta.preview } }, { touch: false });
    }
    return;
  }
  const [pUid, p, g] = a.space.startsWith("u:") ? [aUid, a, b] : [bUid, b, a];
  const gid = g.space.slice(2);
  const ref = `${g.space}/${g.meta.id}`;
  const links = p.meta.links.filter((l) => l !== ref);
  const stillLinked = links.some((l) => parseRef(l).space === g.space);
  const shares = { ...p.meta.shares };
  if (!stillLinked) delete shares[gid];
  patchNote(pUid, { meta: { links, shares, preview: p.meta.preview === ref ? null : p.meta.preview } }, { touch: false });
  if (!stillLinked) void removeSharedCopy(p, gid);
}

export function setShareAccess(pUid: string, gid: string, access: Access) {
  const p = get().notes[pUid];
  if (!p || !p.space.startsWith("u:")) return;
  patchNote(pUid, { meta: { shares: { ...p.meta.shares, [gid]: access } } }, { touch: false });
}

export function setPreview(uid: string, drawingRef: string | null) {
  patchNote(canonicalUid(uid), { meta: { preview: drawingRef } }, { touch: false });
}

// ---------------------------------------------------------------- folders --

export function createFolder(name: string): string {
  const space = personalKey();
  const folder: Folder = { id: newId("f"), name: name.trim(), updated: nowIso() };
  const folders = [...(get().folders[space] ?? []), folder];
  set((s) => ({ folders: { ...s.folders, [space]: folders } }));
  void writeFile(space, PATHS.folders, JSON.stringify({ folders }, null, 1) + "\n", `Add folder ${folder.name}`);
  return folder.id;
}

export function renameFolder(id: string, name: string) {
  const space = personalKey();
  const folders = (get().folders[space] ?? []).map((f) => (f.id === id ? { ...f, name: name.trim(), updated: nowIso() } : f));
  set((s) => ({ folders: { ...s.folders, [space]: folders } }));
  void writeFile(space, PATHS.folders, JSON.stringify({ folders }, null, 1) + "\n", `Rename folder ${name}`);
}

export function deleteFolder(id: string) {
  const space = personalKey();
  const folders = (get().folders[space] ?? []).map((f) => (f.id === id ? { ...f, deleted: true, updated: nowIso() } : f));
  set((s) => ({
    folders: { ...s.folders, [space]: folders },
    context: s.context.folder === id ? { space, folder: null } : s.context,
    view: s.view.kind === "folder" && s.view.folder === id ? { kind: "folder", folder: null } : s.view,
  }));
  for (const [uid, note] of Object.entries(get().notes)) {
    if (note.space === space && note.meta.folder === id) patchNote(uid, { meta: { folder: null } }, { touch: false });
  }
  void writeFile(space, PATHS.folders, JSON.stringify({ folders }, null, 1) + "\n", "Remove folder");
}

// ------------------------------------------------------------------ board --

const boardTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function flushBoard(space: string) {
  if (!boardTimers.has(space)) return;
  clearTimeout(boardTimers.get(space));
  boardTimers.delete(space);
  const latest = get().boards[space];
  if (latest) await writeFile(space, PATHS.board, JSON.stringify(latest, null, 1) + "\n", "");
}

function saveBoard(space: string, board: Board, label: string) {
  set((s) => ({ boards: { ...s.boards, [space]: board } }));
  addLabel(space, label);
  setSpace(space, { pending: true });
  // Typing in a card should not write the file on every keystroke.
  clearTimeout(boardTimers.get(space));
  boardTimers.set(
    space,
    setTimeout(() => void flushBoard(space), 400),
  );
}

/** Puts a file back to an earlier version (used by version history). */
export async function restoreFile(space: string, path: string, text: string) {
  const id = path.split("/").pop()!.replace(/\.(md|excalidraw)$/, "");
  const uid = `${space}/${id}`;
  if (isNotePath(path) && get().notes[uid]) {
    restoreNote(uid, text);
    return;
  }
  await writeFile(space, path, text, `Restore ${path}`);
  await loadSpace(space);
}

export function addCard(space: string, column: string, title: string): string {
  const user = me();
  const board = get().boards[space] ?? normaliseBoard(null);
  const now = nowIso();
  const order = Math.max(0, ...Object.values(board.cards).filter((c) => c.column === column && !c.deleted).map((c) => c.order)) + 1;
  const card: Card = {
    id: newId("c"),
    title,
    description: "",
    column,
    order,
    label: "",
    assignee: null,
    due: null,
    notes: [],
    checklist: [],
    comments: [],
    movedById: user.id,
    movedByName: user.name,
    movedAt: now,
    created: now,
    updated: now,
    updatedById: user.id,
  };
  saveBoard(space, { ...board, cards: { ...board.cards, [card.id]: card } }, `Add card ${title}`);
  return card.id;
}

export function patchCard(space: string, id: string, patch: Partial<Card>) {
  const user = me();
  const board = get().boards[space];
  const card = board?.cards[id];
  if (!board || !card) return;
  const now = nowIso();
  const moved = patch.column !== undefined && patch.column !== card.column;
  const next: Card = {
    ...card,
    ...patch,
    updated: now,
    updatedById: user.id,
    ...(moved ? { movedById: user.id, movedByName: user.name, movedAt: now } : {}),
  };
  saveBoard(space, { ...board, cards: { ...board.cards, [id]: next } }, moved ? `Move ${card.title}` : `Edit card ${card.title}`);
}

export function deleteCard(space: string, id: string) {
  patchCard(space, id, { deleted: true });
}

export function saveColumns(space: string, columns: Board["columns"]) {
  const board = get().boards[space] ?? normaliseBoard(null);
  saveBoard(space, { ...board, columns }, "Edit board columns");
}

// ----------------------------------------------------- windows and views --

export function setCanvasSize(w: number, h: number) {
  const c = get().canvas;
  if (c.w !== w || c.h !== h) set({ canvas: { w, h } });
}

function topZ(): number {
  return Math.max(0, ...get().windows.map((w) => w.z)) + 1;
}

export function openNote(uid: string) {
  uid = canonicalUid(uid);
  const note = get().notes[uid];
  if (!note) return;
  if (note.meta.type === "daily") {
    set({ view: { kind: "daily", date: note.meta.date ?? isoDate() } });
    return;
  }
  const s = get();
  const existing = s.windows.find((w) => w.uid === uid);
  const z = topZ();
  let windows: WindowState[];
  if (existing) {
    windows = s.windows.map((w) => (w.uid === uid ? { ...w, min: false, z } : w));
  } else {
    const open = s.windows.filter((w) => !w.min).length;
    const w = clamp(note.meta.type === "drawing" ? 860 : 820, 360, Math.max(360, s.canvas.w - 48));
    const h = clamp(note.meta.type === "drawing" ? 600 : 640, 260, Math.max(260, s.canvas.h - 100));
    const x = clamp(Math.round((s.canvas.w - w) / 2) - 40 + (open % 5) * 32, 16, Math.max(16, s.canvas.w - w - 16));
    const y = clamp(28 + (open % 5) * 28, 12, Math.max(12, s.canvas.h - h - 60));
    windows = [...s.windows, { uid, x, y, w, h, z, min: false, max: false }];
  }
  set({
    windows,
    activeUid: uid,
    recent: [uid, ...s.recent.filter((r) => r !== uid)].slice(0, 8),
    view: { kind: "canvas" },
    context: note.space.startsWith("g:") ? { space: note.space, folder: null } : s.context.space === note.space ? s.context : { space: note.space, folder: note.meta.folder },
  });
  saveUiSoon();
}

export function focusWindow(uid: string) {
  const s = get();
  const top = Math.max(0, ...s.windows.map((w) => w.z));
  const mine = s.windows.find((w) => w.uid === uid);
  if (!mine) return;
  if (s.activeUid === uid && mine.z === top) return;
  set({ activeUid: uid, windows: s.windows.map((w) => (w.uid === uid ? { ...w, z: top + 1 } : w)) });
  saveUiSoon();
}

export function updateWindow(uid: string, patch: Partial<WindowState>) {
  set((s) => ({ windows: s.windows.map((w) => (w.uid === uid ? { ...w, ...patch } : w)) }));
  saveUiSoon();
}

export function closeWindow(uid: string) {
  set((s) => {
    const windows = s.windows.filter((w) => w.uid !== uid);
    const next = [...windows].filter((w) => !w.min).sort((a, b) => b.z - a.z)[0];
    return { windows, activeUid: s.activeUid === uid ? (next?.uid ?? null) : s.activeUid, findUid: s.findUid === uid ? null : s.findUid };
  });
  saveUiSoon();
}

export function minimiseWindow(uid: string) {
  set((s) => {
    const windows = s.windows.map((w) => (w.uid === uid ? { ...w, min: true, max: false } : w));
    const next = windows.filter((w) => !w.min).sort((a, b) => b.z - a.z)[0];
    return { windows, activeUid: s.activeUid === uid ? (next?.uid ?? null) : s.activeUid };
  });
  saveUiSoon();
}

export function setView(view: View) {
  set({ view });
}

export function selectFolder(folder: string | null) {
  set({ context: { space: personalKey(), folder }, view: { kind: "folder", folder } });
  saveUiSoon();
}

export function openGroup(id: string, tab: GroupTab = "board") {
  const key = groupKey(id);
  set({ context: { space: key, folder: null }, view: { kind: "group", group: id, tab } });
  if (tab === "board" && !get().settings.checklist.board) {
    updateSettings({ checklist: { ...get().settings.checklist, board: true } });
  }
  saveUiSoon();
}

export function openDialog(dialog: Dialog | null) {
  set({ dialog });
}

export function openFind(uid: string | null) {
  set({ findUid: uid });
}

export function focusSearch() {
  set((s) => ({ searchFocus: s.searchFocus + 1 }));
}

// ------------------------------------------------------------------ focus --

export function startFocus(uid?: string, minutes?: number) {
  const s = get();
  const target = uid ?? s.activeUid ?? s.recent.find((r) => s.notes[r]?.meta.type === "text");
  if (!target || !s.notes[target] || s.notes[target].meta.type !== "text") {
    toast({ title: "Open a text note to focus on", body: "Focus mode shows one note and hides everything else." }, { urgent: true });
    return;
  }
  const mins = minutes ?? s.settings.focusMinutes;
  set({ focus: { uid: target, phase: "running", minutes: mins, startedAt: Date.now(), endsAt: Date.now() + mins * 60_000 } });
}

export function setFocus(focus: FocusState | null) {
  set({ focus });
  if (!focus) releaseHeld();
}

/** Adds finished focus time to today's daily note, for the weekly summary. */
export function logFocusMinutes(minutes: number) {
  const date = isoDate();
  const uid = `${personalKey()}/${date}`;
  if (!get().notes[uid]) createNote("daily", { date, open: false });
  const note = get().notes[uid];
  if (note) patchNote(uid, { meta: { focusMinutes: (note.meta.focusMinutes ?? 0) + minutes } }, { touch: false });
}

// ---------------------------------------------------------------- session --

export async function signOut() {
  const user = get().user;
  await flush();
  await syncAll().catch(() => undefined);
  const pending = Object.values(get().spaces).some((sp) => sp.pending);
  const finish = async () => {
    events?.close();
    events = null;
    await authClient.signOut().catch(() => undefined);
    localStorage.removeItem("margin-session");
    if (user) {
      localStorage.removeItem(`margin-ui-${user.id}`);
      await wipeLocal(user.id);
    }
    window.location.assign("/");
  };
  if (pending) {
    set({
      dialog: {
        kind: "confirm",
        title: "Some changes have not reached the server",
        body: "Logging out removes this device's copy of your notes. Changes that have not synced will be lost. Reconnect first if you want to keep them.",
        confirmLabel: "Log out anyway",
        danger: true,
        onConfirm: () => void finish(),
      },
    });
    return;
  }
  await finish();
}

/** Exposed for the browser test suite. */
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__margin = {
    useApp,
    flush,
    syncAll,
    repoFor,
    createNote,
    patchNote,
    linkNotes,
    setPreview,
    openNote,
    addCard,
    patchCard,
    createFolder,
    updateSettings,
    setView,
    startFocus,
    setFocus,
  };
}
