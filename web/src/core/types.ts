/** Shared data shapes. Nothing in `core/` touches React or the DOM. */

export type NoteType = "text" | "drawing" | "daily";
export type NoteColor = "green" | "purple" | "blue" | "yellow" | "coral";
export type Access = "private" | "view" | "edit";

export const NOTE_COLORS: Record<NoteColor, string> = {
  green: "#5fa88c",
  purple: "#8e75cc",
  blue: "#5b8fd0",
  yellow: "#d9ae2e",
  coral: "#d9705f",
};

export interface NoteMeta {
  id: string;
  title: string;
  type: NoteType;
  color: NoteColor;
  /** Folder id inside the note's own space, or null for the top level. */
  folder: string | null;
  tags: string[];
  /**
   * Outgoing links. A bare id points inside the same space; `g:<groupId>/<id>`
   * or `u:<userId>/<id>` points into another space.
   */
  links: string[];
  /** Id of a linked drawing to show when the note is hovered. */
  preview: string | null;
  created: string;
  updated: string;
  updatedById: string;
  updatedByName: string;
  /** Personal notes: access level granted to each group the note is linked into. */
  shares: Record<string, Access>;
  /** Present on the copy that lives in a group's `shared/` folder. */
  sharedOwner?: string;
  sharedOwnerName?: string;
  sharedAccess?: Access;
  /** Daily notes */
  date?: string;
  mood?: string | null;
  template?: string;
  focusMinutes?: number;
  voiceNotes?: { at: string; seconds: number; text: string }[];
}

export interface Note {
  meta: NoteMeta;
  /** Markdown for text and daily notes; the raw `.excalidraw` JSON text for drawings. */
  body: string;
  /** Repo-relative path the note was loaded from. */
  path: string;
  /** Space key, `u:<id>` or `g:<id>`. */
  space: string;
  /** Another version kept after an edit clash, waiting for someone to choose. */
  conflict?: { meta: NoteMeta; body: string; path: string } | null;
}

export interface Folder {
  id: string;
  name: string;
  updated: string;
  deleted?: boolean;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface CardComment {
  id: string;
  byId: string;
  byName: string;
  text: string;
  at: string;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  column: string;
  order: number;
  label: string;
  assignee: string | null;
  due: string | null;
  notes: string[];
  checklist: ChecklistItem[];
  comments: CardComment[];
  movedById: string;
  movedByName: string;
  movedAt: string;
  created: string;
  updated: string;
  updatedById: string;
  deleted?: boolean;
}

export interface BoardColumn {
  id: string;
  name: string;
}

export interface Board {
  version: 1;
  columns: BoardColumn[];
  cards: Record<string, Card>;
}

export const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: "todo", name: "To do" },
  { id: "doing", name: "Doing" },
  { id: "review", name: "Review" },
  { id: "done", name: "Done" },
];

export interface Settings {
  textSize: number;
  accent: string;
  theme: "light" | "dark" | "system";
  highContrast: boolean;
  reduceMotion: boolean;
  font: string;
  breakReminders: boolean;
  focusMinutes: number;
  breakMinutes: number;
  quietHours: { on: boolean; from: string; to: string };
  weeklySummary: boolean;
  notifyGroupChanges: boolean;
  notifyAdded: boolean;
  suggestLinks: boolean;
  tips: { step: number; done: boolean };
  checklist: { note: boolean; drawing: boolean; board: boolean; dismissed: boolean };
  updated: string;
}

export const DEFAULT_SETTINGS: Settings = {
  textSize: 15,
  accent: "#2d6a5f",
  theme: "light",
  highContrast: false,
  reduceMotion: false,
  font: "Inter",
  breakReminders: true,
  focusMinutes: 25,
  breakMinutes: 5,
  quietHours: { on: false, from: "22:00", to: "08:00" },
  weeklySummary: false,
  notifyGroupChanges: true,
  notifyAdded: true,
  suggestLinks: false,
  tips: { step: 0, done: false },
  checklist: { note: false, drawing: false, board: false, dismissed: false },
  updated: "",
};

export interface Author {
  id: string;
  name: string;
  email: string;
}

export const PATHS = {
  folders: ".margin/folders.json",
  settings: ".margin/settings.json",
  board: "board.json",
  note: (id: string) => `notes/${id}.md`,
  drawing: (id: string) => `drawings/${id}.excalidraw`,
  daily: (date: string) => `daily/${date}.md`,
  shared: (owner: string, id: string, type: NoteType) =>
    `shared/${owner}/${id}.${type === "drawing" ? "excalidraw" : "md"}`,
  conflictOf: (path: string) => path.replace(/\.(md|excalidraw)$/, ".conflict.$1"),
};

export function isConflictPath(path: string): boolean {
  return /\.conflict\.(md|excalidraw)$/.test(path);
}

export function isNotePath(path: string): boolean {
  return /^(notes|drawings|daily|shared\/[^/]+)\/[^/]+\.(md|excalidraw)$/.test(path);
}
