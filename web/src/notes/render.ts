import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { parseScene } from "../core/notefile";
import type { Note } from "../core/types";
import { isDark } from "../store/app";

marked.setOptions({ gfm: true, breaks: false });

const htmlCache = new Map<string, string>();

/** Read-only HTML for previews, focus mode and history. */
export function renderMarkdown(markdown: string): string {
  const cached = htmlCache.get(markdown);
  if (cached !== undefined) return cached;
  const prepared = markdown.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
  let html = marked.parse(prepared, { async: false }) as string;
  html = html
    .replace(/<li>(\s*(?:<p>)?)<input checked="" disabled="" type="checkbox">/g, '<li class="task-list-item done">$1<input type="checkbox" checked disabled>')
    .replace(/<li>(\s*(?:<p>)?)<input disabled="" type="checkbox">/g, '<li class="task-list-item">$1<input type="checkbox" disabled>');
  html = html.replace(/<ul>\s*(<li class="task-list-item)/g, '<ul class="contains-task-list">$1');
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ["target"], ADD_DATA_URI_TAGS: ["img"] });
  if (htmlCache.size > 300) htmlCache.clear();
  htmlCache.set(markdown, clean);
  return clean;
}

const svgCache = new Map<string, string>();

/** Renders a drawing note to an SVG data URL using Excalidraw's exporter. */
export async function drawingImage(note: Note, dark = isDark()): Promise<string | null> {
  const key = `${note.space}/${note.meta.id}:${note.meta.updated}:${note.body.length}:${dark ? "d" : "l"}`;
  const cached = svgCache.get(key);
  if (cached) return cached;
  const scene = parseScene(note.body);
  const elements = scene.elements.filter((e) => !e.isDeleted);
  if (elements.length === 0) return null;
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  const svg = await exportToSvg({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    elements: elements as any,
    appState: { exportBackground: false, exportWithDarkMode: dark, exportEmbedScene: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    files: scene.files as any,
    exportPadding: 16,
  });
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  if (svgCache.size > 60) svgCache.clear();
  svgCache.set(key, url);
  return url;
}

export function useDrawingImage(note: Note | null | undefined): { url: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; loading: boolean }>({ url: null, loading: !!note });
  const key = note ? `${note.space}/${note.meta.id}:${note.meta.updated}:${note.body.length}` : "";
  useEffect(() => {
    let live = true;
    if (!note || note.meta.type !== "drawing") {
      setState({ url: null, loading: false });
      return;
    }
    setState((s) => ({ url: s.url, loading: true }));
    drawingImage(note)
      .then((url) => live && setState({ url, loading: false }))
      .catch(() => live && setState({ url: null, loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
