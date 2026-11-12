import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { Lock } from "lucide-react";
import { mergeElements } from "../core/merge";
import { parseScene, sceneText } from "../core/notefile";
import { canEdit, isDark, patchNote, useApp } from "../store/app";
import { LinkedRow } from "./Links";
import { ConflictBanner, SavedLabel } from "./TextNote";

// Excalidraw is large, so it only loads when a drawing is first opened.
const Excalidraw = lazy(() => import("@excalidraw/excalidraw").then((m) => ({ default: m.Excalidraw })));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = any;
type El = Record<string, unknown> & { id: string; version?: number; isDeleted?: boolean; updated?: number };

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

function signature(elements: readonly El[], files: Record<string, unknown>): string {
  let sum = 0;
  for (const e of elements) sum += (e.version ?? 0) + (e.isDeleted ? 1 : 0);
  return `${elements.length}:${sum}:${Object.keys(files ?? {}).length}`;
}

export function DrawingNote({ uid, layoutKey }: { uid: string; layoutKey: string }) {
  const note = useApp((s) => s.notes[uid]);
  const rev = useApp((s) => s.revs[uid] ?? 0);
  const themeKey = useApp((s) => `${s.settings.theme}:${s.settings.accent}`);
  const editable = note ? canEdit(note) : false;
  const api = useRef<Api>(null);
  const lastSig = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<{ elements: readonly El[]; appState: Record<string, unknown>; files: Record<string, unknown> } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [dark, setDark] = useState(isDark());

  useEffect(() => setDark(isDark()), [themeKey]);

  const initialData = useMemo(() => {
    const scene = parseScene(useApp.getState().notes[uid]?.body ?? "");
    lastSig.current = signature(scene.elements as El[], scene.files);
    return {
      elements: scene.elements,
      appState: { viewBackgroundColor: (scene.appState.viewBackgroundColor as string) ?? "#ffffff", currentItemFontFamily: 5 },
      files: scene.files,
      scrollToContent: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const save = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    const current = useApp.getState().notes[uid];
    if (!p || !current) return;
    const cutoff = Date.now() - TWO_WEEKS;
    // Deleted shapes are kept for a while so the deletion reaches other members' copies.
    const elements = p.elements.filter((e) => !e.isDeleted || (e.updated ?? 0) > cutoff);
    const body = sceneText(current.meta, { elements: elements as Record<string, unknown>[], appState: p.appState, files: p.files });
    patchNote(uid, { body });
  }, [uid]);

  const onChange = useCallback(
    (elements: readonly El[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      const z = Math.round((((appState.zoom as { value?: number })?.value ?? 1) as number) * 100);
      setZoom((prev) => (prev === z ? prev : z));
      const sig = signature(elements, files);
      if (sig === lastSig.current) return;
      lastSig.current = sig;
      pending.current = { elements, appState, files };
      clearTimeout(timer.current);
      timer.current = setTimeout(save, 600);
    },
    [save],
  );

  useEffect(() => () => save(), [save]);

  // Someone else's strokes arrived: fold them into the open scene.
  useEffect(() => {
    if (rev === 0 || !api.current) return;
    const incoming = parseScene(useApp.getState().notes[uid]?.body ?? "");
    const current = api.current.getSceneElementsIncludingDeleted() as El[];
    const merged = mergeElements(current, incoming.elements as El[]);
    const sig = signature(merged, incoming.files);
    if (sig === signature(current, api.current.getFiles?.() ?? {})) return;
    lastSig.current = sig;
    const files = Object.values(incoming.files ?? {});
    if (files.length) api.current.addFiles(files);
    api.current.updateScene({ elements: merged, captureUpdate: "NEVER" });
  }, [rev, uid]);

  // The window moved or resized: Excalidraw needs to re-measure its offsets.
  useEffect(() => {
    const t = setTimeout(() => api.current?.refresh?.(), 60);
    return () => clearTimeout(t);
  }, [layoutKey]);

  if (!note) return null;
  return (
    <>
      {!editable ? (
        <div className="flex items-center gap-2 px-4 border-b border-hair bg-surface-3 t12 text-ink-2 flex-none" style={{ height: 40 }}>
          <Lock size={14} /> {note.meta.sharedOwnerName} shared this drawing as view only.
        </div>
      ) : null}
      <ConflictBanner uid={uid} />
      <div className="drawing-host" data-testid="drawing-host">
        <Suspense fallback={<div className="absolute inset-0 grid place-items-center t13 text-muted">Opening the drawing tools…</div>}>
          <Excalidraw
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            initialData={initialData as any}
            excalidrawAPI={(a: Api) => {
              api.current = a;
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onChange={onChange as any}
            viewModeEnabled={!editable}
            theme={dark ? "dark" : "light"}
            name={note.meta.title}
            UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false, saveAsImage: true, export: { saveFileToDisk: true } } }}
          />
        </Suspense>
      </div>
      <div className="status-bar" style={{ height: "auto", minHeight: 40, flexWrap: "wrap", paddingTop: 6, paddingBottom: 6 }}>
        <LinkedRow uid={uid} compact />
        <span className="flex-1" />
        <SavedLabel uid={uid} />
        <span>{zoom}%</span>
      </div>
    </>
  );
}
