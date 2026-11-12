import YAML from "yaml";
import type { Access, Note, NoteMeta, NoteType } from "./types";
import { isConflictPath } from "./types";

/**
 * Notes are plain files so that a clone of a space is readable without Margin:
 *   - text and daily notes: Markdown with a YAML front matter block
 *   - drawings: a standard `.excalidraw` JSON file with a `margin` key
 */

const ORDER: (keyof NoteMeta)[] = [
  "id",
  "title",
  "type",
  "color",
  "folder",
  "tags",
  "links",
  "preview",
  "shares",
  "sharedOwner",
  "sharedOwnerName",
  "sharedAccess",
  "date",
  "mood",
  "template",
  "focusMinutes",
  "voiceNotes",
  "created",
  "updated",
  "updatedById",
  "updatedByName",
];

export function blankMeta(id: string, type: NoteType, now = new Date().toISOString()): NoteMeta {
  return {
    id,
    title: type === "drawing" ? "Untitled drawing" : "Untitled note",
    type,
    color: type === "drawing" ? "purple" : "green",
    folder: null,
    tags: [],
    links: [],
    preview: null,
    created: now,
    updated: now,
    updatedById: "",
    updatedByName: "",
    shares: {},
  };
}

function normaliseMeta(raw: Record<string, unknown>, fallbackId: string, type: NoteType): NoteMeta {
  const base = blankMeta(String(raw.id ?? fallbackId), (raw.type as NoteType) ?? type, String(raw.created ?? ""));
  const meta: NoteMeta = { ...base };
  if (typeof raw.title === "string") meta.title = raw.title;
  if (typeof raw.color === "string") meta.color = raw.color as NoteMeta["color"];
  meta.folder = typeof raw.folder === "string" && raw.folder ? raw.folder : null;
  meta.tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
  meta.links = Array.isArray(raw.links) ? raw.links.map(String) : [];
  meta.preview = typeof raw.preview === "string" && raw.preview ? raw.preview : null;
  meta.updated = String(raw.updated ?? meta.created);
  meta.updatedById = String(raw.updatedById ?? "");
  meta.updatedByName = String(raw.updatedByName ?? "");
  meta.shares = raw.shares && typeof raw.shares === "object" ? (raw.shares as Record<string, Access>) : {};
  if (raw.sharedOwner) meta.sharedOwner = String(raw.sharedOwner);
  if (raw.sharedOwnerName) meta.sharedOwnerName = String(raw.sharedOwnerName);
  if (raw.sharedAccess) meta.sharedAccess = String(raw.sharedAccess) as Access;
  if (raw.date) meta.date = String(raw.date);
  if (raw.mood !== undefined) meta.mood = raw.mood ? String(raw.mood) : null;
  if (raw.template) meta.template = String(raw.template);
  if (typeof raw.focusMinutes === "number") meta.focusMinutes = raw.focusMinutes;
  if (Array.isArray(raw.voiceNotes)) meta.voiceNotes = raw.voiceNotes as NoteMeta["voiceNotes"];
  return meta;
}

function orderedMeta(meta: NoteMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ORDER) {
    const value = meta[key];
    if (value === undefined) continue;
    if (key === "shares" && Object.keys(meta.shares).length === 0) continue;
    if ((key === "tags" || key === "links") && (value as unknown[]).length === 0) continue;
    if ((key === "preview" || key === "folder") && value === null) continue;
    out[key] = value;
  }
  return out;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function typeFromPath(path: string): NoteType {
  if (path.endsWith(".excalidraw")) return "drawing";
  if (path.startsWith("daily/")) return "daily";
  return "text";
}

function idFromPath(path: string): string {
  const file = path.split("/").pop() ?? "";
  return file.replace(/\.conflict\.(md|excalidraw)$/, "").replace(/\.(md|excalidraw)$/, "");
}

export function parseNoteFile(path: string, text: string): { meta: NoteMeta; body: string } {
  const type = typeFromPath(path);
  const id = idFromPath(path);
  if (type === "drawing") {
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* treated as an empty drawing */
    }
    const meta = normaliseMeta((json.margin as Record<string, unknown>) ?? {}, id, "drawing");
    meta.type = "drawing";
    return { meta, body: text };
  }
  const m = text.match(FM);
  let raw: Record<string, unknown> = {};
  let body = text;
  if (m) {
    try {
      raw = (YAML.parse(m[1]) as Record<string, unknown>) ?? {};
    } catch {
      raw = {};
    }
    body = text.slice(m[0].length);
  }
  const meta = normaliseMeta(raw, id, type);
  meta.type = type;
  return { meta, body: body.replace(/^\n+/, "") };
}

export interface Scene {
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export function parseScene(body: string): Scene {
  try {
    const json = JSON.parse(body);
    return {
      elements: Array.isArray(json.elements) ? json.elements : [],
      appState: json.appState && typeof json.appState === "object" ? json.appState : {},
      files: json.files && typeof json.files === "object" ? json.files : {},
    };
  } catch {
    return { elements: [], appState: {}, files: {} };
  }
}

export function sceneText(meta: NoteMeta, scene: Scene): string {
  return (
    JSON.stringify(
      {
        type: "excalidraw",
        version: 2,
        source: "margin",
        elements: scene.elements,
        appState: {
          viewBackgroundColor: scene.appState.viewBackgroundColor ?? "#ffffff",
          gridSize: scene.appState.gridSize ?? null,
        },
        files: scene.files,
        margin: orderedMeta(meta),
      },
      null,
      1,
    ) + "\n"
  );
}

export function serializeNoteFile(meta: NoteMeta, body: string): string {
  if (meta.type === "drawing") return sceneText(meta, parseScene(body));
  const fm = YAML.stringify(orderedMeta(meta), { lineWidth: 0 }).trimEnd();
  return `---\n${fm}\n---\n\n${body.replace(/\s+$/, "")}\n`;
}

export function noteFromFile(space: string, path: string, text: string): Note {
  const { meta, body } = parseNoteFile(path, text);
  return { meta, body, path, space, conflict: null };
}

/** What other members see when a personal note is linked as "private". */
export function privateStub(meta: NoteMeta): { meta: NoteMeta; body: string } {
  return {
    meta: { ...meta, title: "Private note", tags: [], preview: null, shares: {}, voiceNotes: undefined },
    body: meta.type === "drawing" ? sceneText({ ...meta, title: "Private note" }, { elements: [], appState: {}, files: {} }) : "",
  };
}

// ----------------------------------------------------------------- refs ----

export interface Ref {
  space: string | null;
  id: string;
}

export function parseRef(ref: string): Ref {
  const slash = ref.indexOf("/");
  if (slash === -1) return { space: null, id: ref };
  return { space: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

export function makeRef(fromSpace: string, toSpace: string, id: string): string {
  return fromSpace === toSpace ? id : `${toSpace}/${id}`;
}

// ----------------------------------------------------------------- text ----

/** Plain text of a Markdown body, for search, previews and word counts. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*\[[ xX]\]\s+/gm, "")
    .replace(/[*_~`=>]+/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function drawingText(body: string): string {
  return parseScene(body)
    .elements.filter((e) => e.type === "text" && !e.isDeleted)
    .map((e) => String(e.text ?? ""))
    .join(" ");
}

export function noteText(note: Note): string {
  return note.meta.type === "drawing" ? drawingText(note.body) : plainText(note.body);
}

export function wordCount(markdown: string): number {
  const t = plainText(markdown);
  return t ? t.split(/\s+/).length : 0;
}

export { isConflictPath };
